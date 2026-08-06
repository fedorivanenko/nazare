import type {
	CachedComputation,
	CachedComputationDependency,
	ComputationCache,
} from "./cache.js";
import {
	canonicalProductKey,
	fingerprintProductKey,
	type ProductKey,
} from "./canonical-key.js";
import type {
	Computation,
	ComputationContext,
	ComputationMetadata,
	ComputationPriority,
	ComputationUncertainty,
} from "./computation.js";
import type { Product } from "./product.js";

const INPUT_DEPENDENCY_PREFIX = "input:";
const PRODUCT_DEPENDENCY_PREFIX = "product:";

export type ComputationRequestOptions = {
	signal?: AbortSignal;
	priority?: ComputationPriority;
	revision?: number;
};

export type ComputationTelemetryError = {
	name: string;
	message: string;
	code?: string;
};

export type ComputationTelemetryEvent =
	| {
			type: "computed" | "memory-hit" | "cache-hit" | "invalidated";
			cacheKey: string;
			revision: number;
	  }
	| {
			type: "cache-fault";
			operation: "read" | "write" | "delete";
			cacheKey: string;
			revision: number;
			error: ComputationTelemetryError;
	  };

export type ComputationGraphOptions = {
	cache?: ComputationCache;
	onTelemetry?: (event: ComputationTelemetryEvent) => void;
};

export type ComputationGraphUpdate = {
	setInput(key: string, value: ProductKey): void;
	removeInput(key: string): void;
	commit(): number;
	rollback(): void;
};

export type ComputationGraph = {
	readonly revision: number;
	register<Key extends ProductKey, Result, Snapshot extends ProductKey>(
		computation: Computation<Key, Result, Snapshot>,
	): void;
	get<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		options?: ComputationRequestOptions,
	): Promise<Result>;
	metadata<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		options?: ComputationRequestOptions,
	): Promise<ComputationMetadata>;
	beginUpdate(): ComputationGraphUpdate;
};

type RegisteredComputation = Computation<ProductKey, unknown>;

type ProductNode = {
	generation: number;
	hasValue: boolean;
	value?: unknown;
	fingerprint?: string;
	diagnostics: ComputationMetadata["diagnostics"];
	uncertainty: readonly ComputationUncertainty[];
	dependencies: Set<string>;
	pending?: Promise<unknown>;
	controller?: AbortController;
};

type Evaluation = {
	revision: number;
	priority: ComputationPriority;
	ancestry: ReadonlySet<string>;
	producer?: string;
};

export class ComputationCycleError extends Error {
	readonly products: readonly string[];

	constructor(products: readonly string[]) {
		super(`Computation cycle detected: ${products.join(" -> ")}`);
		this.name = "ComputationCycleError";
		this.products = products;
	}
}

export class ObsoleteComputationRevisionError extends Error {
	readonly expected: number;
	readonly actual: number;

	constructor(expected: number, actual: number) {
		super(
			`Computation revision ${expected} is obsolete; current revision is ${actual}`,
		);
		this.name = "ObsoleteComputationRevisionError";
		this.expected = expected;
		this.actual = actual;
	}
}

export function createComputationGraph(
	options: ComputationGraphOptions = {},
): ComputationGraph {
	return new DefaultComputationGraph(options.cache, options.onTelemetry);
}

class DefaultComputationGraph implements ComputationGraph {
	private readonly computations = new Map<string, RegisteredComputation>();
	private readonly inputs = new Map<string, ProductKey>();
	private readonly inputFingerprints = new Map<string, string>();
	private readonly nodes = new Map<string, ProductNode>();
	private readonly dependentsByDependency = new Map<string, Set<string>>();
	private readonly waitCountsByProduct = new Map<string, Map<string, number>>();
	private revisionValue = 0;

	constructor(
		private readonly cache?: ComputationCache,
		private readonly onTelemetry?: (event: ComputationTelemetryEvent) => void,
	) {}

	get revision(): number {
		return this.revisionValue;
	}

	register<Key extends ProductKey, Result, Snapshot extends ProductKey>(
		computation: Computation<Key, Result, Snapshot>,
	): void {
		const identity = productIdentity(computation);
		if (this.computations.has(identity)) {
			throw new Error(`Computation already registered: ${identity}`);
		}
		this.computations.set(
			identity,
			computation as unknown as RegisteredComputation,
		);
	}

	async get<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		options: ComputationRequestOptions = {},
	): Promise<Result> {
		const revision = options.revision ?? this.revisionValue;
		this.assertRevision(revision);
		const result = await this.evaluate(
			product,
			{
				revision,
				priority: options.priority ?? "background",
				ancestry: new Set(),
			},
			options.signal,
		);
		this.assertRevision(revision);
		return result;
	}

	async metadata<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		options: ComputationRequestOptions = {},
	): Promise<ComputationMetadata> {
		await this.get(product, options);
		const diagnostics = new Map<
			string,
			ComputationMetadata["diagnostics"][number]
		>();
		const uncertainty = new Map<string, ComputationUncertainty>();
		const pending = [product.cacheKey];
		const visited = new Set<string>();

		while (pending.length > 0) {
			const cacheKey = pending.pop();
			if (cacheKey === undefined || visited.has(cacheKey)) continue;
			visited.add(cacheKey);
			const node = this.nodes.get(cacheKey);
			if (!node) continue;
			for (const diagnostic of node.diagnostics) {
				diagnostics.set(JSON.stringify(diagnostic), diagnostic);
			}
			for (const item of node.uncertainty) {
				uncertainty.set(JSON.stringify(item), item);
			}
			for (const dependency of node.dependencies) {
				if (dependency.startsWith(PRODUCT_DEPENDENCY_PREFIX)) {
					pending.push(dependency.slice(PRODUCT_DEPENDENCY_PREFIX.length));
				}
			}
		}

		return {
			diagnostics: [...diagnostics.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([, diagnostic]) => diagnostic),
			uncertainty: [...uncertainty.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([, item]) => item),
		};
	}

	beginUpdate(): ComputationGraphUpdate {
		const baseRevision = this.revisionValue;
		const sets = new Map<string, ProductKey>();
		const removals = new Set<string>();
		let closed = false;

		const assertOpen = (): void => {
			if (closed) throw new Error("Computation graph update is already closed");
			if (this.revisionValue !== baseRevision) {
				throw new Error(
					`Computation graph changed during update ${baseRevision}`,
				);
			}
		};

		return {
			setInput(key, value) {
				assertInputKey(key);
				assertOpen();
				// Validate serializability before any transaction state can commit.
				fingerprintProductKey(value);
				sets.set(key, value);
				removals.delete(key);
			},
			removeInput(key) {
				assertInputKey(key);
				assertOpen();
				sets.delete(key);
				removals.add(key);
			},
			commit: () => {
				assertOpen();
				closed = true;
				const changed = new Set<string>();

				for (const key of removals) {
					if (!this.inputs.delete(key)) continue;
					this.inputFingerprints.delete(key);
					changed.add(inputDependency(key));
				}
				for (const [key, value] of sets) {
					const fingerprint = fingerprintProductKey(value);
					if (this.inputFingerprints.get(key) === fingerprint) continue;
					this.inputs.set(key, value);
					this.inputFingerprints.set(key, fingerprint);
					changed.add(inputDependency(key));
				}

				if (changed.size === 0) return this.revisionValue;
				this.revisionValue++;
				this.abortPendingComputations();
				this.invalidateDependencies(changed);
				return this.revisionValue;
			},
			rollback() {
				assertOpen();
				closed = true;
			},
		};
	}

	private async evaluate<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		evaluation: Evaluation,
		requestSignal?: AbortSignal,
	): Promise<Result> {
		this.assertRevision(evaluation.revision);
		const productDependencyId = productDependency(product.cacheKey);
		if (evaluation.ancestry.has(productDependencyId)) {
			throw new ComputationCycleError([
				...evaluation.ancestry,
				productDependencyId,
			]);
		}

		const computation = this.computations.get(productIdentity(product));
		if (!computation) {
			throw new Error(
				`No computation registered for ${productIdentity(product)}`,
			);
		}

		const node = this.node(product.cacheKey);
		if (node.hasValue) {
			this.emitTelemetry("memory-hit", product.cacheKey);
			return node.value as Result;
		}
		if (node.pending) {
			return waitForRequest(node.pending as Promise<Result>, requestSignal);
		}

		const generation = node.generation;
		const ancestry = new Set(evaluation.ancestry);
		ancestry.add(productDependencyId);
		const controller = new AbortController();
		node.controller = controller;
		const pending = this.restoreOrCompute(
			product,
			computation,
			node,
			generation,
			{ ...evaluation, ancestry, producer: product.cacheKey },
			controller,
		).finally(() => {
			if (node.pending === pending) node.pending = undefined;
			if (node.controller === controller) node.controller = undefined;
		});
		node.pending = pending;

		return waitForRequest(pending as Promise<Result>, requestSignal);
	}

	private async restoreOrCompute<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		computation: RegisteredComputation,
		node: ProductNode,
		generation: number,
		evaluation: Evaluation,
		controller: AbortController,
	): Promise<Result> {
		const restored = await this.restoreCached(
			product,
			computation,
			node,
			generation,
			evaluation,
			controller,
		);
		if (restored.hit) {
			this.emitTelemetry("cache-hit", product.cacheKey);
			return restored.value as Result;
		}

		const dependencies = new Set<string>();
		const dependencyRecords = new Map<string, CachedComputationDependency>();
		const context: ComputationContext = {
			signal: controller.signal,
			priority: evaluation.priority,
			get: async <DependencyKey extends ProductKey, DependencyResult>(
				dependency: Product<DependencyKey, DependencyResult>,
			): Promise<DependencyResult> => {
				const dependencyId = productDependency(dependency.cacheKey);
				dependencies.add(dependencyId);
				const result = await this.waitForDependency(
					product.cacheKey,
					dependency.cacheKey,
					() => this.evaluate(dependency, evaluation, controller.signal),
				);
				const dependencyNode = this.node(dependency.cacheKey);
				if (!dependencyNode.fingerprint) {
					throw new Error(
						`Dependency did not produce a fingerprint: ${dependency.cacheKey}`,
					);
				}
				dependencyRecords.set(dependencyId, {
					kind: "product",
					product: {
						namespace: dependency.namespace,
						id: dependency.id,
						version: dependency.version,
						key: dependency.key,
						cacheKey: dependency.cacheKey,
					},
					fingerprint: dependencyNode.fingerprint,
				});
				return result;
			},
			input: async <InputResult>(key: string): Promise<InputResult> => {
				assertInputKey(key);
				dependencies.add(inputDependency(key));
				if (!this.inputs.has(key)) {
					throw new Error(`Missing computation input: ${key}`);
				}
				const fingerprint = this.inputFingerprints.get(key);
				if (!fingerprint) throw new Error(`Missing input fingerprint: ${key}`);
				dependencyRecords.set(inputDependency(key), {
					kind: "input",
					key,
					fingerprint,
				});
				return this.inputs.get(key) as InputResult;
			},
		};

		const result = await computation.compute(context, product.key);
		const cachedDependencies = [...dependencyRecords.values()];
		const productFingerprint = fingerprintComputationProduct(
			product.cacheKey,
			cachedDependencies,
		);
		const cachedEntry =
			this.cache && computation.cache
				? (() => {
						const snapshot = computation.cache.encode(result);
						return {
							snapshot,
							snapshotFingerprint: fingerprintProductKey(snapshot),
							productFingerprint,
							dependencies: cachedDependencies,
						};
					})()
				: undefined;
		this.emitTelemetry("computed", product.cacheKey);
		if (!this.canCommitNode(node, generation, evaluation, controller)) {
			return result as Result;
		}

		this.replaceDependencies(product.cacheKey, node, dependencies);
		node.value = result;
		node.hasValue = true;
		this.replaceMetadata(node, computation, result);
		node.fingerprint = productFingerprint;

		if (cachedEntry) await this.writeCache(product.cacheKey, cachedEntry);

		return result as Result;
	}

	private async restoreCached<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		computation: RegisteredComputation,
		node: ProductNode,
		generation: number,
		evaluation: Evaluation,
		controller: AbortController,
	): Promise<{ hit: false } | { hit: true; value: unknown }> {
		if (!this.cache || !computation.cache) return { hit: false };
		const cached = await this.readCache(product.cacheKey);
		if (!cached) return { hit: false };
		if (fingerprintProductKey(cached.snapshot) !== cached.snapshotFingerprint) {
			await this.deleteCache(product.cacheKey);
			return { hit: false };
		}
		if (
			fingerprintComputationProduct(product.cacheKey, cached.dependencies) !==
			cached.productFingerprint
		) {
			await this.deleteCache(product.cacheKey);
			return { hit: false };
		}

		const dependencies = new Set<string>();
		for (const dependency of cached.dependencies) {
			if (dependency.kind === "input") {
				if (
					this.inputFingerprints.get(dependency.key) !== dependency.fingerprint
				) {
					return { hit: false };
				}
				dependencies.add(inputDependency(dependency.key));
				continue;
			}

			const restoredProduct = dependency.product as Product<
				ProductKey,
				unknown
			>;
			if (productCacheKey(restoredProduct) !== restoredProduct.cacheKey) {
				await this.deleteCache(product.cacheKey);
				return { hit: false };
			}
			await this.waitForDependency(
				evaluation.producer,
				restoredProduct.cacheKey,
				() => this.evaluate(restoredProduct, evaluation, controller.signal),
			);
			if (
				this.node(restoredProduct.cacheKey).fingerprint !==
				dependency.fingerprint
			) {
				return { hit: false };
			}
			dependencies.add(productDependency(restoredProduct.cacheKey));
		}

		if (!this.canCommitNode(node, generation, evaluation, controller)) {
			return { hit: false };
		}
		const value = computation.cache.decode(cached.snapshot);
		this.replaceDependencies(product.cacheKey, node, dependencies);
		node.value = value;
		node.fingerprint = cached.productFingerprint;
		node.hasValue = true;
		this.replaceMetadata(node, computation, value);
		return { hit: true, value };
	}

	private canCommitNode(
		node: ProductNode,
		generation: number,
		evaluation: Evaluation,
		controller: AbortController,
	): boolean {
		return (
			node.generation === generation &&
			this.revisionValue === evaluation.revision &&
			!controller.signal.aborted
		);
	}

	private node(cacheKey: string): ProductNode {
		let node = this.nodes.get(cacheKey);
		if (node) return node;
		node = {
			generation: 0,
			hasValue: false,
			diagnostics: [],
			uncertainty: [],
			dependencies: new Set(),
		};
		this.nodes.set(cacheKey, node);
		return node;
	}

	private replaceMetadata(
		node: ProductNode,
		computation: RegisteredComputation,
		value: unknown,
	): void {
		node.diagnostics = computation.diagnostics?.(value) ?? [];
		node.uncertainty = computation.uncertainty?.(value) ?? [];
	}

	private replaceDependencies(
		cacheKey: string,
		node: ProductNode,
		dependencies: ReadonlySet<string>,
	): void {
		for (const dependency of node.dependencies) {
			const dependents = this.dependentsByDependency.get(dependency);
			dependents?.delete(cacheKey);
			if (dependents?.size === 0) {
				this.dependentsByDependency.delete(dependency);
			}
		}

		node.dependencies = new Set(dependencies);
		for (const dependency of dependencies) {
			const dependents =
				this.dependentsByDependency.get(dependency) ?? new Set<string>();
			dependents.add(cacheKey);
			this.dependentsByDependency.set(dependency, dependents);
		}
	}

	private invalidateDependencies(initial: ReadonlySet<string>): void {
		const pending = [...initial];
		const visitedDependencies = new Set<string>();
		const invalidatedNodes = new Set<string>();

		while (pending.length > 0) {
			const dependency = pending.pop();
			if (dependency === undefined || visitedDependencies.has(dependency)) {
				continue;
			}
			visitedDependencies.add(dependency);

			for (const cacheKey of this.dependentsByDependency.get(dependency) ??
				[]) {
				if (invalidatedNodes.has(cacheKey)) continue;
				invalidatedNodes.add(cacheKey);
				const node = this.nodes.get(cacheKey);
				if (!node) continue;
				node.generation++;
				node.hasValue = false;
				node.value = undefined;
				node.fingerprint = undefined;
				node.diagnostics = [];
				node.uncertainty = [];
				node.controller?.abort();
				this.emitTelemetry("invalidated", cacheKey);
				pending.push(productDependency(cacheKey));
			}
		}
	}

	private async waitForDependency<Result>(
		producer: string | undefined,
		dependency: string,
		evaluate: () => Promise<Result>,
	): Promise<Result> {
		if (!producer) return evaluate();
		this.addWait(producer, dependency);
		try {
			return await evaluate();
		} finally {
			this.removeWait(producer, dependency);
		}
	}

	private addWait(from: string, to: string): void {
		const path = this.waitPath(to, from);
		if (path) throw new ComputationCycleError([from, ...path]);
		const waits =
			this.waitCountsByProduct.get(from) ?? new Map<string, number>();
		waits.set(to, (waits.get(to) ?? 0) + 1);
		this.waitCountsByProduct.set(from, waits);
	}

	private removeWait(from: string, to: string): void {
		const waits = this.waitCountsByProduct.get(from);
		const count = waits?.get(to);
		if (!waits || count === undefined) return;
		if (count > 1) waits.set(to, count - 1);
		else waits.delete(to);
		if (waits.size === 0) this.waitCountsByProduct.delete(from);
	}

	private waitPath(from: string, target: string): string[] | undefined {
		const visit = (
			current: string,
			path: readonly string[],
		): string[] | undefined => {
			if (current === target) return [...path, current];
			for (const next of this.waitCountsByProduct.get(current)?.keys() ?? []) {
				if (path.includes(next)) continue;
				const found = visit(next, [...path, current]);
				if (found) return found;
			}
			return undefined;
		};
		return visit(from, []);
	}

	private emitTelemetry(
		type: "computed" | "memory-hit" | "cache-hit" | "invalidated",
		cacheKey: string,
	): void {
		this.onTelemetry?.({ type, cacheKey, revision: this.revisionValue });
	}

	private emitCacheFault(
		operation: "read" | "write" | "delete",
		cacheKey: string,
		error: unknown,
	): void {
		this.onTelemetry?.({
			type: "cache-fault",
			operation,
			cacheKey,
			revision: this.revisionValue,
			error: normalizeTelemetryError(error),
		});
	}

	private abortPendingComputations(): void {
		for (const node of this.nodes.values()) node.controller?.abort();
	}

	private assertRevision(revision: number): void {
		if (revision !== this.revisionValue) {
			throw new ObsoleteComputationRevisionError(revision, this.revisionValue);
		}
	}

	private async readCache(
		cacheKey: string,
	): Promise<CachedComputation | undefined> {
		try {
			return await this.cache?.read(cacheKey);
		} catch (error) {
			this.emitCacheFault("read", cacheKey, error);
			return undefined;
		}
	}

	private async writeCache(
		cacheKey: string,
		value: CachedComputation,
	): Promise<void> {
		try {
			await this.cache?.write(cacheKey, value);
		} catch (error) {
			this.emitCacheFault("write", cacheKey, error);
		}
	}

	private async deleteCache(cacheKey: string): Promise<void> {
		try {
			await this.cache?.delete(cacheKey);
		} catch (error) {
			this.emitCacheFault("delete", cacheKey, error);
		}
	}
}

function normalizeTelemetryError(error: unknown): ComputationTelemetryError {
	if (error instanceof Error) {
		const code =
			"code" in error && typeof error.code === "string"
				? error.code
				: undefined;
		return {
			name: error.name || "Error",
			message: error.message,
			...(code ? { code } : {}),
		};
	}
	try {
		return { name: "Error", message: String(error) };
	} catch {
		return { name: "Error", message: "Unprintable cache error" };
	}
}

function productIdentity(value: {
	namespace: string;
	id: string;
	version: number;
}): string {
	return `${value.namespace}:${value.id}@${value.version}`;
}

function productCacheKey(product: Product<ProductKey, unknown>): string {
	return `${productIdentity(product)}:${canonicalProductKey(product.key)}`;
}

function fingerprintComputationProduct(
	cacheKey: string,
	dependencies: readonly CachedComputationDependency[],
): string {
	const dependencyKeys: ProductKey[] = dependencies.map((dependency) =>
		dependency.kind === "input"
			? {
					kind: "input",
					key: dependency.key,
					fingerprint: dependency.fingerprint,
				}
			: {
					kind: "product",
					key: dependency.product.cacheKey,
					fingerprint: dependency.fingerprint,
				},
	);
	dependencyKeys.sort((left, right) =>
		canonicalProductKey(left).localeCompare(canonicalProductKey(right)),
	);
	return fingerprintProductKey({
		product: cacheKey,
		dependencies: dependencyKeys,
	});
}

function inputDependency(key: string): string {
	return `${INPUT_DEPENDENCY_PREFIX}${key}`;
}

function productDependency(cacheKey: string): string {
	return `${PRODUCT_DEPENDENCY_PREFIX}${cacheKey}`;
}

function assertInputKey(key: string): void {
	if (!key) throw new TypeError("Computation input key is required");
}

async function waitForRequest<Result>(
	promise: Promise<Result>,
	signal?: AbortSignal,
): Promise<Result> {
	if (!signal) return promise;
	if (signal.aborted) throw abortError();

	return new Promise<Result>((resolve, reject) => {
		const abort = (): void => reject(abortError());
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}

function abortError(): Error {
	return new DOMException("Computation request aborted", "AbortError");
}

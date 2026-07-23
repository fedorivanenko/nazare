import type { ThemeDeclaration, ThemeFact } from "./theme-facts.js";

export class ThemeRenderDependencyIndex {
	private readonly targetsBySource = new Map<string, Set<string>>();
	private readonly sourcesByTarget = new Map<string, Set<string>>();
	private readonly sourcesByDeclarationKey = new Map<string, Set<string>>();
	private readonly groupByPath = new Map<string, string[]>();

	constructor(
		declarations: ThemeDeclaration[],
		renderFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[],
	) {
		const snippetPathsByName = new Map<string, string[]>();
		for (const declaration of declarations) {
			if (declaration.kind !== "snippet") continue;
			const paths = snippetPathsByName.get(declaration.name) ?? [];
			paths.push(declaration.path);
			snippetPathsByName.set(declaration.name, paths);
		}
		for (const fact of renderFacts) {
			if (!fact.static || !fact.targetName) continue;
			add(
				this.sourcesByDeclarationKey,
				`snippet:${fact.targetName}`,
				fact.fromPath,
			);
			const targets = snippetPathsByName.get(fact.targetName) ?? [];
			if (targets.length !== 1 || !targets[0]) continue;
			add(this.targetsBySource, fact.fromPath, targets[0]);
			add(this.sourcesByTarget, targets[0], fact.fromPath);
		}
		for (const group of stronglyConnectedComponents(this.targetsBySource)) {
			for (const path of group) this.groupByPath.set(path, group);
		}
	}

	getTargets(sourcePath: string): string[] {
		return sorted(this.targetsBySource.get(sourcePath));
	}

	getCallers(targetPath: string): string[] {
		return sorted(this.sourcesByTarget.get(targetPath));
	}

	getCallersForDeclarationKey(key: string): string[] {
		return sorted(this.sourcesByDeclarationKey.get(key));
	}

	getStronglyConnectedGroup(path: string): string[] {
		return [...(this.groupByPath.get(path) ?? [path])];
	}

	getAffectedGroups(changedPaths: Iterable<string>): string[][] {
		const visited = new Set<string>();
		const pending = [...changedPaths].sort().reverse();
		while (pending.length > 0) {
			const path = pending.pop();
			if (!path || visited.has(path)) continue;
			visited.add(path);
			for (const adjacent of [
				...this.getTargets(path),
				...this.getCallers(path),
			]
				.sort()
				.reverse()) {
				if (!visited.has(adjacent)) pending.push(adjacent);
			}
		}
		const groups = new Map<string, string[]>();
		for (const path of [...visited].sort()) {
			const group = this.getStronglyConnectedGroup(path);
			groups.set(group.join("\0"), group);
		}
		return [...groups.values()].sort((a, b) =>
			a.join("\0").localeCompare(b.join("\0")),
		);
	}
}

function stronglyConnectedComponents(
	edges: Map<string, Set<string>>,
): string[][] {
	const nodes = new Set<string>();
	for (const [source, targets] of edges) {
		nodes.add(source);
		for (const target of targets) nodes.add(target);
	}
	const indexes = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const groups: string[][] = [];
	let nextIndex = 0;

	const visit = (node: string): void => {
		indexes.set(node, nextIndex);
		lowLinks.set(node, nextIndex);
		nextIndex += 1;
		stack.push(node);
		onStack.add(node);
		for (const target of sorted(edges.get(node))) {
			if (!indexes.has(target)) {
				visit(target);
				lowLinks.set(
					node,
					Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0),
				);
			} else if (onStack.has(target)) {
				lowLinks.set(
					node,
					Math.min(lowLinks.get(node) ?? 0, indexes.get(target) ?? 0),
				);
			}
		}
		if (lowLinks.get(node) !== indexes.get(node)) return;
		const group: string[] = [];
		while (stack.length > 0) {
			const member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			group.push(member);
			if (member === node) break;
		}
		groups.push(group.sort());
	};

	for (const node of [...nodes].sort()) {
		if (!indexes.has(node)) visit(node);
	}
	return groups.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
	const values = map.get(key) ?? new Set<string>();
	values.add(value);
	map.set(key, values);
}

function sorted(values: Set<string> | undefined): string[] {
	return [...(values ?? [])].sort((a, b) => a.localeCompare(b));
}

import type { Diagnostic } from "@nazare/core";

export type ThemeDiagnosticOwner = {
	pass: string;
	owner: string;
};

export type OwnedThemeDiagnostic = ThemeDiagnosticOwner & {
	diagnostic: Diagnostic;
};

export class ThemeDiagnosticStore {
	private readonly diagnosticsByOwner: Map<string, OwnedThemeDiagnostic[]>;

	constructor(diagnostics: Iterable<OwnedThemeDiagnostic> = []) {
		this.diagnosticsByOwner = new Map();
		for (const entry of diagnostics) {
			const key = ownerKey(entry.pass, entry.owner);
			const values = this.diagnosticsByOwner.get(key) ?? [];
			values.push(entry);
			this.diagnosticsByOwner.set(key, values);
		}
	}

	fork(): ThemeDiagnosticStore {
		const fork = new ThemeDiagnosticStore();
		for (const [key, values] of this.diagnosticsByOwner) {
			fork.diagnosticsByOwner.set(key, values);
		}
		return fork;
	}

	replace(owner: ThemeDiagnosticOwner, diagnostics: Diagnostic[]): void {
		assertOwner(owner);
		const key = ownerKey(owner.pass, owner.owner);
		if (diagnostics.length === 0) {
			this.diagnosticsByOwner.delete(key);
			return;
		}
		this.diagnosticsByOwner.set(
			key,
			diagnostics.map((diagnostic) => ({ ...owner, diagnostic })),
		);
	}

	remove(owner: ThemeDiagnosticOwner): void {
		assertOwner(owner);
		this.diagnosticsByOwner.delete(ownerKey(owner.pass, owner.owner));
	}

	getOwned(owner?: Partial<ThemeDiagnosticOwner>): OwnedThemeDiagnostic[] {
		return [...this.diagnosticsByOwner.values()]
			.flat()
			.filter(
				(entry) =>
					(!owner?.pass || entry.pass === owner.pass) &&
					(!owner?.owner || entry.owner === owner.owner),
			)
			.sort(compareOwnedDiagnostics);
	}

	getAll(): Diagnostic[] {
		return this.getOwned().map((entry) => entry.diagnostic);
	}
}

function assertOwner(owner: ThemeDiagnosticOwner): void {
	if (!owner.pass.trim()) throw new Error("Diagnostic pass owner is required");
	if (!owner.owner.trim()) throw new Error("Diagnostic key owner is required");
}

function ownerKey(pass: string, owner: string): string {
	return `${pass}\0${owner}`;
}

function compareOwnedDiagnostics(
	a: OwnedThemeDiagnostic,
	b: OwnedThemeDiagnostic,
): number {
	return (
		a.pass.localeCompare(b.pass) ||
		a.owner.localeCompare(b.owner) ||
		a.diagnostic.code.localeCompare(b.diagnostic.code) ||
		a.diagnostic.message.localeCompare(b.diagnostic.message)
	);
}

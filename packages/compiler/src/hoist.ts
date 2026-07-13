// Setting hoisting: any render argument the author leaves unfilled, for a
// prop the dependency declared as a setting (or a setting the dependency
// itself hoisted), surfaces at this component's boundary — filling the
// argument is the opt-out. Setting ids are <alias>_<name> (snake_case) and
// accumulate per level, so a button label two components down becomes
// card_button_label at the section. Two render sites of the same alias with
// unfilled setting-props cannot share knobs; the fix is importing the
// package twice under different aliases.
import type {
	ArtifactContract,
	ArtifactIR,
	Diagnostic,
	Id,
	PropTypeInfo,
} from "@nazare/core";
import { hoistedAliasReused, hoistedSettingCollision } from "./diagnostics.js";
import { componentSymbolIdForFile } from "./ids.js";
import { indexArtifactIR } from "./ir-index.js";

export type HoistedSetting = {
	/** Setting id at this level, e.g. "promo_link_href". */
	settingId: string;
	/** The import alias whose render site hoists it (header group label). */
	alias: string;
	renderSiteId: Id;
	/** Argument name the dependency expects for this value. */
	argName: string;
	/** Project-relative path of the component file declaring the leaf prop. */
	sourcePath: string;
	sourcePropName: string;
	typeInfo: PropTypeInfo;
};

export type HoistResolution = {
	hoisted: HoistedSetting[];
	issues: Diagnostic[];
};

export function resolveHoistedSettings(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
): HoistResolution {
	const index = indexArtifactIR(ir);
	const contractsBySymbolId = new Map(
		contracts.map((contract) => [contract.componentSymbolId, contract]),
	);
	const pathByLocalName = new Map<string, string>();
	for (const node of index.nodesOfKind("import")) {
		pathByLocalName.set(node.localName, node.path);
	}

	const hoisted: HoistedSetting[] = [];
	const issues: Diagnostic[] = [];
	const hoistingSitesByAlias = new Map<string, Id>();
	const usedSettingIds = new Map<string, string>(
		index
			.nodesOfKind("prop-declaration")
			.map((node) => [node.name, `own prop ${node.name}`]),
	);

	for (const site of index.nodesOfKind("render-site")) {
		const path = pathByLocalName.get(site.targetName);
		if (!path) continue;
		const contract = contractsBySymbolId.get(componentSymbolIdForFile(path));
		if (!contract) continue;

		const filled = new Set(
			site.argumentIds
				.map((argumentId) => index.nodeById.get(argumentId))
				.filter((node) => node?.kind === "prop-argument")
				.map((node) => node.name),
		);

		const unfilled: Omit<
			HoistedSetting,
			"settingId" | "alias" | "renderSiteId"
		>[] = [];
		for (const prop of contract.props) {
			if (!prop.typeInfo.setting || filled.has(prop.name)) continue;
			unfilled.push({
				argName: prop.name,
				sourcePath: contract.path,
				sourcePropName: prop.name,
				typeInfo: prop.typeInfo,
			});
		}
		for (const entry of contract.hoisted ?? []) {
			if (filled.has(entry.name)) continue;
			unfilled.push({
				argName: entry.name,
				sourcePath: entry.sourcePath,
				sourcePropName: entry.sourcePropName,
				typeInfo: entry.typeInfo,
			});
		}
		if (unfilled.length === 0) continue;

		const previousSite = hoistingSitesByAlias.get(site.targetName);
		if (previousSite !== undefined) {
			issues.push(hoistedAliasReused(site.targetName, site.id, site.span));
			continue;
		}
		hoistingSitesByAlias.set(site.targetName, site.id);

		for (const entry of unfilled) {
			const settingId = `${snakeCase(site.targetName)}_${entry.argName}`;
			const owner = usedSettingIds.get(settingId);
			if (owner) {
				issues.push(
					hoistedSettingCollision(settingId, owner, site.id, site.span),
				);
				continue;
			}
			usedSettingIds.set(settingId, `render of ${site.targetName}`);
			hoisted.push({
				settingId,
				alias: site.targetName,
				renderSiteId: site.id,
				...entry,
			});
		}
	}

	return { hoisted, issues };
}

/** PromoLink -> promo_link */
export function snakeCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[-\s]+/g, "_")
		.toLowerCase();
}

/** PromoLink -> "Promo link" */
export function humanizeAlias(alias: string): string {
	const words = snakeCase(alias).split("_").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

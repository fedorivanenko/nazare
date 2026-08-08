import type { CliOptions } from "./options.js";

export type FeatureStability = "stable" | "experimental" | "internal";
export type FeatureEffect =
	| "read"
	| "filesystem-write"
	| "network-write"
	| "publication";
export type FeatureConsent = "automatic" | "explicit" | "invocation";

export type FeatureDefinition = {
	id: string;
	description: string;
	stability: FeatureStability;
	effects: readonly FeatureEffect[];
	consent: FeatureConsent;
	since: string;
	trackingIssue?: number;
	enableAliases?: readonly string[];
};

export const FEATURES = {
	"feature-discovery": {
		id: "feature-discovery",
		description: "List public feature stability and effects",
		stability: "stable",
		effects: ["read"],
		consent: "automatic",
		since: "0.1.0",
	},
	"source-analysis": {
		id: "source-analysis",
		description: "Emit versioned parser facts for one source file",
		stability: "stable",
		effects: ["read"],
		consent: "automatic",
		since: "0.1.0",
	},
	"compiler-inspection": {
		id: "compiler-inspection",
		description:
			"Inspect unstable compiler implementation projections for one file",
		stability: "experimental",
		effects: ["read", "filesystem-write"],
		consent: "invocation",
		since: "0.1.0",
		trackingIssue: 152,
	},
	"theme-inspection": {
		id: "theme-inspection",
		description: "Inspect and query stable one-shot whole-theme JSON contracts",
		stability: "stable",
		effects: ["read"],
		consent: "automatic",
		since: "0.1.0",
	},
	"theme-build": {
		id: "theme-build",
		description: "Analyze and prepare deterministic theme build products",
		stability: "stable",
		effects: ["read"],
		consent: "automatic",
		since: "0.1.0",
	},
	"theme-publication": {
		id: "theme-publication",
		description: "Publish generated theme output and reconcile merchant data",
		stability: "experimental",
		effects: ["filesystem-write", "network-write", "publication"],
		consent: "invocation",
		since: "0.1.0",
		trackingIssue: 150,
		enableAliases: ["--experimental-publish"],
	},
	"inspection-server": {
		id: "inspection-server",
		description:
			"Serve inspection tools over the experimental MCP stdio protocol",
		stability: "experimental",
		effects: ["read"],
		consent: "explicit",
		since: "0.1.0",
		trackingIssue: 150,
	},
	preview: {
		id: "preview",
		description: "Build, serve, and mutate component preview workbenches",
		stability: "stable",
		effects: ["read", "filesystem-write", "network-write"],
		consent: "automatic",
		since: "0.1.0",
	},
	registry: {
		id: "registry",
		description: "Install, update, diff, and publish registry components",
		stability: "stable",
		effects: ["read", "filesystem-write", "network-write"],
		consent: "automatic",
		since: "0.1.0",
	},
	"project-initialization": {
		id: "project-initialization",
		description: "Scaffold explicit project build configuration",
		stability: "stable",
		effects: ["filesystem-write"],
		consent: "automatic",
		since: "0.1.0",
	},
	"liquid-block-partial": {
		id: "liquid-block-partial",
		description:
			"Reserved compiler capability for Liquid block and partial syntax",
		stability: "internal",
		effects: ["read"],
		consent: "automatic",
		since: "0.1.0",
	},
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureId = keyof typeof FEATURES;
export type FeatureEnablementSource = "cli" | "environment";

declare const FEATURE_PERMIT: unique symbol;
export type FeaturePermit<Id extends FeatureId> = {
	readonly feature: Id;
	readonly [FEATURE_PERMIT]: Id;
};

export type FeatureGateway = {
	require<Id extends FeatureId>(feature: Id): FeaturePermit<Id>;
};

export class FeatureAccessError extends Error {
	readonly code = "NAZARE_FEATURE_DISABLED";

	constructor(
		readonly feature: FeatureId,
		message: string,
	) {
		super(message);
		this.name = "FeatureAccessError";
	}
}

const issuedPermits = new WeakSet<object>();

export function createFeatureGateway(
	options: {
		cliEnabled?: Iterable<string>;
		environmentEnabled?: Iterable<string>;
		invocationFeature?: FeatureId;
	} = {},
): FeatureGateway {
	const enablement = new Map<FeatureId, Set<FeatureEnablementSource>>();
	addEnablement(enablement, options.cliEnabled ?? [], "cli");
	addEnablement(enablement, options.environmentEnabled ?? [], "environment");

	return Object.freeze({
		require<Id extends FeatureId>(feature: Id): FeaturePermit<Id> {
			const definition = FEATURES[feature];
			if (definition.stability === "internal") {
				throw new FeatureAccessError(
					feature,
					`Feature ${feature} is internal and unavailable through the public CLI.`,
				);
			}
			if (definition.stability === "experimental") {
				const sources = enablement.get(feature);
				const enabled =
					definition.consent === "invocation"
						? sources?.has("cli") === true
						: sources !== undefined && sources.size > 0;
				if (!enabled) {
					const aliases =
						"enableAliases" in definition && definition.enableAliases.length > 0
							? ` (alias: ${definition.enableAliases.join(", ")})`
							: "";
					const invocationEnablement =
						options.invocationFeature === feature
							? "--enable-experimental"
							: `--enable-experimental=${feature}`;
					throw new FeatureAccessError(
						feature,
						definition.consent === "invocation"
							? `Experimental feature ${feature} requires per-invocation consent. Re-run with ${invocationEnablement}${aliases}.`
							: `Experimental feature ${feature} is disabled. Re-run with ${invocationEnablement} or set NAZARE_EXPERIMENTAL_FEATURES=${feature}.`,
					);
				}
			}
			const permit = Object.freeze({ feature }) as FeaturePermit<Id>;
			issuedPermits.add(permit);
			return permit;
		},
	});
}

export function createCliFeatureGateway(
	options: CliOptions,
	environment: NodeJS.ProcessEnv = process.env,
	invocationFeature?: FeatureId,
): FeatureGateway {
	return createFeatureGateway({
		cliEnabled: [
			...(options.enabledExperimentalFeatures ?? []),
			...(options.enableInvocationExperimental && invocationFeature
				? [invocationFeature]
				: []),
		],
		environmentEnabled: parseExperimentalFeatureEnvironment(
			environment.NAZARE_EXPERIMENTAL_FEATURES,
		),
		invocationFeature,
	});
}

export function assertFeaturePermit<Id extends FeatureId>(
	permit: FeaturePermit<Id> | undefined,
	feature: Id,
): asserts permit is FeaturePermit<Id> {
	if (
		permit === undefined ||
		typeof permit !== "object" ||
		!issuedPermits.has(permit) ||
		permit.feature !== feature
	) {
		throw new FeatureAccessError(
			feature,
			`A valid ${feature} feature permit is required.`,
		);
	}
}

export function publicFeatures(): readonly FeatureDefinition[] {
	return Object.values(FEATURES)
		.filter((feature) => feature.stability !== "internal")
		.sort((left, right) => left.id.localeCompare(right.id));
}

export function experimentalFeatureIds(): readonly FeatureId[] {
	return publicFeatures()
		.filter((feature) => feature.stability === "experimental")
		.map((feature) => feature.id as FeatureId);
}

export function experimentalFeatureAliases(): readonly {
	alias: string;
	feature: FeatureId;
}[] {
	return publicFeatures().flatMap((feature) =>
		feature.stability === "experimental" && feature.enableAliases
			? feature.enableAliases.map((alias) => ({
					alias,
					feature: feature.id as FeatureId,
				}))
			: [],
	);
}

export function featureForEnableAlias(alias: string): FeatureId | undefined {
	return experimentalFeatureAliases().find((entry) => entry.alias === alias)
		?.feature;
}

export type InvocationFeatureRule = {
	commands: readonly string[];
	feature: FeatureId;
	firstPositionals?: readonly string[];
};

/**
 * Public command routing declares stability here. More-specific positional
 * rules precede command fallbacks; adding a command never needs gateway logic.
 */
export const INVOCATION_FEATURE_RULES = [
	{ commands: ["features"], feature: "feature-discovery" },
	{ commands: ["source"], feature: "source-analysis" },
	{
		commands: ["inspect"],
		firstPositionals: ["serve"],
		feature: "inspection-server",
	},
	{ commands: ["build", "check"], feature: "theme-build" },
	{ commands: ["preview"], feature: "preview" },
	{ commands: ["init"], feature: "project-initialization" },
	{
		commands: ["registry", "add", "update", "publish"],
		feature: "registry",
	},
	{
		commands: ["inspect"],
		firstPositionals: ["theme", "impact", "metafield"],
		feature: "theme-inspection",
	},
	{
		commands: ["inspect"],
		firstPositionals: ["ast", "ir", "graph", "schema", "artifact", "dump"],
		feature: "compiler-inspection",
	},
] as const satisfies readonly InvocationFeatureRule[];

export function featureForInvocation(
	command: string,
	options: CliOptions,
): FeatureId | undefined {
	return (INVOCATION_FEATURE_RULES as readonly InvocationFeatureRule[]).find(
		(rule) =>
			rule.commands.includes(command) &&
			(rule.firstPositionals === undefined ||
				rule.firstPositionals.includes(options.positionals[0] ?? "")),
	)?.feature;
}

function addEnablement(
	target: Map<FeatureId, Set<FeatureEnablementSource>>,
	features: Iterable<string>,
	source: FeatureEnablementSource,
): void {
	for (const feature of features) {
		if (
			!isFeatureId(feature) ||
			FEATURES[feature].stability !== "experimental"
		) {
			throw new Error(
				`Unknown experimental feature ${feature}; expected one of: ${publicFeatures()
					.filter((definition) => definition.stability === "experimental")
					.map((definition) => definition.id)
					.join(", ")}`,
			);
		}
		const sources = target.get(feature) ?? new Set<FeatureEnablementSource>();
		sources.add(source);
		target.set(feature, sources);
	}
}

function isFeatureId(value: string): value is FeatureId {
	return Object.hasOwn(FEATURES, value);
}

function parseExperimentalFeatureEnvironment(
	value: string | undefined,
): readonly string[] {
	return value
		? value
				.split(",")
				.map((feature) => feature.trim())
				.filter(Boolean)
		: [];
}

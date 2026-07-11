// Shopify {% schema %} JSON, as the compiler emits it from props .setting()
// metadata. Only the subset Nazare generates is modeled — this is an output
// format, not a full Shopify schema binding.

export type ThemeSchemaSettingOption = {
	value: string;
	label: string;
};

export type ThemeSchemaSetting = {
	type: string;
	id?: string;
	label?: string;
	/** header-type settings carry content instead of id/label. */
	content?: string;
	default?: unknown;
	options?: ThemeSchemaSettingOption[];
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
};

export type ThemeSchema = {
	name: string;
	settings: ThemeSchemaSetting[];
};

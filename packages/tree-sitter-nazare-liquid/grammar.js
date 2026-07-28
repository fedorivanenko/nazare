const Liquid = require("../tree-sitter-liquid/grammar.js");

module.exports = grammar(Liquid, {
	name: "nazare_liquid",

	externals: ($, previous) => [
		...previous.slice(0, -1),
		$.nazare_script_content,
		$.nazare_stylesheet_content,
		previous[previous.length - 1],
	],

	rules: {
		_tagged_unpaired_statement: ($, previous) =>
			choice(
				tag(
					choice(
						$.nazare_component_statement,
						$.nazare_import_statement,
						$.nazare_props_statement,
						$.nazare_blocks_statement,
						$.nazare_render_statement,
					),
				),
				previous,
			),

		_tagged_paired_statment: ($, previous) =>
			choice($.nazare_script_statement, previous),

		nazare_component_statement: (_) =>
			seq("component", field("kind", choice("section", "block", "snippet"))),

		nazare_import_statement: ($) =>
			seq(
				"import",
				field("local_name", $.identifier),
				"from",
				field("source", $.string),
			),

		nazare_props_statement: (_) =>
			seq("props", field("payload", alias(/\{[^%]*\}/, "props_payload"))),

		nazare_blocks_statement: ($) =>
			seq(
				"blocks",
				optional(
					seq(
						field("name", $.identifier),
						repeat(seq(",", field("name", $.identifier))),
					),
				),
			),

		nazare_render_statement: ($) =>
			seq(
				"render",
				field("target", $.identifier),
				field("payload", alias(/\{[^}]*\}/, "render_payload")),
			),

		nazare_script_statement: ($) =>
			seq(
				tag("script", optional(seq("lang", "=", field("language", $.string)))),
				optional(field("body", $.nazare_script_content)),
				tag("endscript"),
			),

		stylesheet_statement: ($) =>
			seq(
				tag("stylesheet", optional(field("binding", $.identifier))),
				optional(field("body", $.nazare_stylesheet_content)),
				tag("endstylesheet"),
			),
	},
});

function tag(...rules) {
	return seq(choice("{%", "{%-"), ...rules, choice("%}", "-%}"));
}

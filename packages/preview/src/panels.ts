// The per-component panels: install command, diagnostics, emitted code, props
// table. Two shells present them — the long single-file gallery and the
// workbench, which shows one story at a time — so they live apart from either.
import type { Diagnostic } from "@nazare/core";
import type { PreviewComponent } from "./component.js";
import type { PreviewControl } from "./controls.js";
import { escapeHtml, escapeJson } from "./html.js";

export function copyButton(text: string, label = "Copy"): string {
	return `<button class="copy" type="button" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

const formatValue = (value: unknown): string =>
	value === undefined ? "—" : JSON.stringify(value);

/** The props table, shadcn's docs shape: prop, type, default, required. */
export function renderControlsTable(controls: PreviewControl[]): string {
	if (controls.length === 0) {
		return '<p class="empty-note">No typed props — plain Liquid declares none, so its stories supply their own values.</p>';
	}
	const rows = controls
		.map(
			(control) => `
            <tr>
              <td><code>${escapeHtml(control.name)}</code></td>
              <td><span class="type">${escapeHtml(
								control.options
									? control.options.map((option) => `"${option}"`).join(" | ")
									: control.typeExpression,
							)}</span></td>
              <td><code class="muted">${escapeHtml(formatValue(control.value))}</code></td>
              <td>${control.required ? '<span class="badge badge--required">required</span>' : '<span class="muted">—</span>'}</td>
            </tr>`,
		)
		.join("");
	return `
        <table class="props">
          <thead><tr><th>Prop</th><th>Type</th><th>Default</th><th>Required</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
}

export function renderIssues(issues: Diagnostic[]): string {
	const reportable = issues.filter((issue) => issue.severity !== "info");
	if (reportable.length === 0) return "";
	return `<ul class="issues">${reportable
		.map(
			(issue) =>
				`<li class="issue issue--${issue.severity}"><code>${escapeHtml(
					issue.code,
				)}</code> ${escapeHtml(issue.message)}</li>`,
		)
		.join("")}</ul>`;
}

/** `nazare add @nazare/button`, copyable, as on a shadcn registry page. */
export function renderInstall(component: PreviewComponent): string {
	if (!component.packageId) return "";
	const install = `nazare add ${component.packageId}`;
	return `<div class="install"><code>${escapeHtml(install)}</code>${copyButton(install)}</div>`;
}

/** The emitted template — what a storefront actually receives. */
export function renderCode(component: PreviewComponent): string {
	return `
        <div class="code">
          ${copyButton(component.template, "Copy")}
          <pre><code>${escapeHtml(component.template)}</code></pre>
        </div>`;
}

export function renderKindLine(component: PreviewComponent): string {
	const kind = component.componentKind ?? "plain Liquid";
	return `
        <p class="component-sub">
          <span class="badge">${escapeHtml(kind)}</span>
          <span class="badge badge--muted">${escapeHtml(component.frontend)}</span>
          <code class="muted">${escapeHtml(component.file)}</code>
        </p>`;
}

/** Controls as data, so an args panel can be layered on without a rebuild. */
export function renderControlsJson(controls: PreviewControl[]): string {
	return `<script type="application/json" class="controls-json">${escapeJson(controls)}</script>`;
}

/* Nazare runtime */
(function nazareRuntime() {
    // Not redundant: this body is extracted via toString() and re-wrapped as a
    // standalone IIFE in the emitted asset, where strict mode must be declared.
    // biome-ignore lint/suspicious/noRedundantUseStrict: shipped as standalone script
    "use strict";
    const win = window;
    if (win.Nazare)
        return;
    function island(setup) {
        return setup;
    }
    function refLookup(root, key) {
        if (root.getAttribute("data-nz-ref") === key)
            return root;
        return root.querySelector(`[data-nz-ref="${key}"]`);
    }
    function parseValue(raw, kind) {
        if (raw === undefined)
            return undefined;
        if (kind === "number")
            return Number(raw);
        if (kind === "boolean")
            return raw === "true";
        return raw;
    }
    function buildData(root, descriptor) {
        const data = {};
        Object.keys(descriptor || {}).forEach((refName) => {
            const element = refLookup(root, refName);
            const entry = {};
            Object.keys(descriptor[refName]).forEach((property) => {
                const raw = element ? element.dataset[property] : undefined;
                entry[property] = parseValue(raw, descriptor[refName][property]);
            });
            data[refName] = entry;
        });
        return data;
    }
    function mountRoots(componentRoot, placement) {
        if (!placement)
            return [componentRoot];
        const targets = [];
        if (componentRoot.getAttribute("data-nz-island") === placement) {
            targets.push(componentRoot);
        }
        componentRoot
            .querySelectorAll(`[data-nz-island="${placement}"]`)
            .forEach((element) => {
            targets.push(element);
        });
        return targets;
    }
    function mount(name, placement, setup, descriptor) {
        document
            .querySelectorAll(`[data-nz-component="${name}"]`)
            .forEach((componentRoot) => {
            mountRoots(componentRoot, placement).forEach((root) => {
                const host = root;
                if (!host.nazareMounted)
                    host.nazareMounted = [];
                if (host.nazareMounted.indexOf(setup) !== -1)
                    return;
                host.nazareMounted.push(setup);
                const refs = new Proxy({}, {
                    get: (_target, key) => {
                        if (typeof key !== "string")
                            return undefined;
                        return refLookup(root, key);
                    },
                });
                setup({ root: root, refs: refs, data: buildData(root, descriptor) });
            });
        });
    }
    function register(name, placement, setup, descriptor) {
        if (typeof setup !== "function")
            return;
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                mount(name, placement, setup, descriptor);
            });
        }
        else {
            mount(name, placement, setup, descriptor);
        }
    }
    win.Nazare = { island: island, register: register, mount: mount };
})();

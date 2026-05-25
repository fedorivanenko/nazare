import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { nazareThemePlugin } from "./nazare/vite-plugin.js";

export default defineConfig({
	plugins: [nazareThemePlugin(), tailwindcss()],
	build: {
		outDir: "assets",
		emptyOutDir: false,
		copyPublicDir: false,
		manifest: false,
		rollupOptions: {
			input: {
				base: "styles/base.css",
			},
			output: {
				entryFileNames: "[name].js",
				chunkFileNames: "[name].js",
				assetFileNames: "[name][extname]",
			},
		},
	},
});

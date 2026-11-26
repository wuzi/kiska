import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

// Axum serves stable entry URLs. Include shared initial styles even when Rollup
// extracts them from the entry file because both React roots import a component.
function entryStyles(): Plugin {
  return {
    name: "axum-entry-styles",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const entry of ["public", "workspace"]) {
        const seen = new Set<string>();
        const css = new Set<string>();
        function visit(file: string) {
          if (seen.has(file)) return;
          seen.add(file);
          const chunk = bundle[file];
          if (chunk?.type !== "chunk") return;
          chunk.imports.forEach(visit);
          chunk.viteMetadata?.importedCss.forEach((path) => css.add(path));
        }
        visit("assets/" + entry + ".js");
        this.emitFile({
          type: "asset",
          fileName: "assets/" + entry + ".css",
          source: [...css]
            .map((path) => {
              const asset = bundle[path];
              return asset?.type === "asset" ? String(asset.source) : "";
            })
            .join("\n"),
        });
      }
    },
    async writeBundle(options, bundle) {
      if (!options.dir) return;
      for (const name of Object.keys(bundle)) {
        if (!/\.(css|js)$/.test(name)) continue;
        // Vite fills dynamic-import preload tokens late in generateBundle.
        // Compress the final emitted bytes served by Axum.
        const file = resolve(options.dir, name);
        await writeFile(
          file + ".gz",
          gzipSync(await readFile(file), { level: 9 }),
        );
      }
    },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (/^\/app(?:[/?]|$)/.test(request.url || ""))
          request.url = "/dev-workspace.html";
        next();
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), entryStyles()],
  server: {
    proxy: {
      "/api": process.env.API_ORIGIN || "http://127.0.0.1:8080",
      "/avatar": process.env.API_ORIGIN || "http://127.0.0.1:8080",
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        public: resolve(import.meta.dirname, "src/public.tsx"),
        workspace: resolve(import.meta.dirname, "src/workspace.tsx"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

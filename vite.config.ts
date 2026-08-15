import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import pkg from "./package.json" with { type: "json" };

const root = dirname(fileURLToPath(import.meta.url));

const deps = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "node22",
    minify: false,
    lib: {
      entry: resolve(root, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: (id) => {
        if (nodeBuiltins.includes(id) || id.startsWith("node:")) return true;
        if (deps.some((d) => id === d || id.startsWith(`${d}/`))) return true;
        if (id.startsWith("@computesdk/") || id.startsWith("@grpc/")) return true;
        return false;
      },
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
      insertTypesEntry: true,
      // rollupTypes: true (rollup-plugin-dts's single-file bundling pass)
      // reproducibly scrambled export names in GitHub Actions CI —
      // consumers saw e.g. "'ZeishConfig' declared locally, but exported as
      // 'assertSandboxTransition'" — while never failing locally or in a
      // clean Docker build on the same Node/pnpm versions, across many
      // repeated attempts on both a full monorepo install and a standalone
      // build. That split (100% CI failure, 0% reproduction anywhere else)
      // points at a resource-constrained-runner flakiness class in
      // rollup-plugin-dts's bundling rather than anything in this repo.
      // insertTypesEntry still emits a single dist/index.d.ts, just one
      // that re-exports the per-module declarations rollup-plugin-dts
      // would otherwise have bundled — same public surface, without the
      // flaky bundling pass.
      rollupTypes: false,
      tsconfigPath: resolve(root, "tsconfig.json"),
      exclude: ["src/**/*.test.ts"],
    }),
  ],
});

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
      // Must stay true: per-file output (rollupTypes: false) makes
      // insertTypesEntry's index.d.ts re-export sibling files with
      // extension-less relative specifiers ("./zeish.types"), which
      // "moduleResolution": "NodeNext" consumers (e.g. arin) cannot
      // resolve at all — every named export disappears. Bundling into one
      // file removes the internal relative imports entirely, sidestepping
      // that entirely.
      rollupTypes: true,
      tsconfigPath: resolve(root, "tsconfig.json"),
      exclude: ["src/**/*.test.ts"],
    }),
  ],
});

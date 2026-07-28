import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

const expected = [
  "generated/typescript",
  "generated/python",
  "generated/go",
  "generated/sandboxd/generated/typescript/sandboxd/v1/sandboxd_pb.ts",
];

for (const path of expected) {
  await access(path);
}

const apiEntries = await readdir(join("generated", "typescript"));
if (!apiEntries.some((entry) => entry.endsWith(".ts") || entry === "apis")) {
  throw new Error(
    "The generated TypeScript REST package contains no TypeScript sources.",
  );
}

console.log(
  "Generated TypeScript, Python, Go, and sandboxd contract artifacts are present.",
);

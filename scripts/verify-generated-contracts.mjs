import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

const target = process.argv[2];
if (target !== "rest" && target !== "sandboxd") {
  throw new Error(
    "Pass either rest or sandboxd to verify generated contract artifacts.",
  );
}

const expected =
  target === "rest"
    ? ["generated/typescript", "generated/python", "generated/go"]
    : ["generated/sandboxd/generated/typescript/sandboxd/v1/sandboxd_pb.ts"];

for (const path of expected) {
  await access(path);
}

if (target === "rest") {
  const apiEntries = await readdir(join("generated", "typescript"));
  if (!apiEntries.some((entry) => entry.endsWith(".ts") || entry === "apis")) {
    throw new Error(
      "The generated TypeScript REST package contains no TypeScript sources.",
    );
  }
}

console.log(`Generated ${target} contract artifacts are present.`);

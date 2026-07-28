import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const target = process.argv.find(argument => argument === "rest" || argument === "sandboxd");
if (target !== "rest" && target !== "sandboxd") {
  throw new Error(
    "Pass either rest or sandboxd to verify generated contract artifacts.",
  );
}

const expected =
  target === "rest"
    ? [
        "generated/typescript/package.json",
        "generated/typescript/src/index.ts",
        "generated/python/pyproject.toml",
        "generated/python/zeish_edge/__init__.py",
        "generated/go/go.mod",
      ]
    : ["generated/sandboxd/generated/typescript/sandboxd/v1/sandboxd_pb.ts"];

for (const path of expected) {
  await access(path);
}

if (target === "rest") {
  const typescriptPackage = JSON.parse(
    await readFile(join("generated", "typescript", "package.json"), "utf8"),
  );
  if (typescriptPackage.name !== "@zeish/edge")
    throw new Error("The generated TypeScript package must be named @zeish/edge.");

  const pythonProject = await readFile(join("generated", "python", "pyproject.toml"), "utf8");
  if (!pythonProject.includes('name = "zeish_edge"'))
    throw new Error("The generated Python package must be named zeish_edge.");

  const goModule = await readFile(join("generated", "go", "go.mod"), "utf8");
  if (!goModule.startsWith("module github.com/spinupdev/zeish-computesdk-go\n"))
    throw new Error("The generated Go module must use the Zeish module path.");
}

console.log(`Generated ${target} contract artifacts are present.`);

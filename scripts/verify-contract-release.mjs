import { readFile } from "node:fs/promises";
import { join } from "node:path";

const target = process.argv.find(argument => argument === "rest" || argument === "sandboxd");
const roots = {
  rest: "contracts/edge-public",
  sandboxd: "contracts/sandboxd",
};
const prefixes = {
  rest: "edge-public-v",
  sandboxd: "sandboxd-v",
};

if (!(target in roots)) {
  throw new Error("Pass either rest or sandboxd to verify a contract release.");
}

const releasePath = join(roots[target], "release.json");
const release = JSON.parse(await readFile(releasePath, "utf8"));

if (release.sourceRepository !== "spinupdev/edge") {
  throw new Error(
    `${releasePath} does not identify spinupdev/edge as its source.`,
  );
}
if (
  typeof release.tag !== "string" ||
  !release.tag.startsWith(prefixes[target])
) {
  throw new Error(
    `${releasePath} does not contain a ${prefixes[target]} release tag.`,
  );
}
if (
  typeof release.commit !== "string" ||
  !/^[0-9a-f]{40}$/i.test(release.commit)
) {
  throw new Error(`${releasePath} does not contain a full source commit SHA.`);
}

console.log(`Verified ${target} contract provenance from ${release.tag}.`);

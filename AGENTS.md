# Contributor and agent guide

This repository is the Zeish ComputeSDK provider: a handwritten TypeScript
facade over the generated public REST client and sandboxd's generated RPC
bindings. `contracts/` is copied from the control-plane repository by a release
workflow and must not be edited here.

## Product naming

- The product is Zeish. Do not use `edge` or `depot` as a product or service
  name in new code, comments, or docs. Name a counterpart by its role (the
  control plane, the data plane, the proxy) or its process. Existing generated
  `depot.*` proto packages and copied contract files keep their names; do not
  rename them.

## Layering

- `createZeishApi()` is the single low-level HTTP client for the control-plane
  REST API. `createZeishSandboxClient()` and the ComputeSDK `zeish()` provider
  are thin adapters over it plus the sandboxd data plane; they must not build
  their own request paths.
- A rule the API enforces (TTL clamps, terminal statuses, ingress shape) is
  encoded once as a helper or constant and reused, not re-derived per call
  site.

## Pre-PR checklist

Run this before opening or updating a PR.

Scope and design

- Smallest change that makes the intended behavior clear; unrelated fixes go
  in their own PR.
- No copy-pasted logic. A transform or guard that now lives in two places is
  extracted into one function and both call it. Prefer composing small
  functions over another flag on a large one.
- New behavior goes through the existing client seam, not a parallel request
  builder.

Naming and comments

- No `edge`/`depot` as a name in new code or docs.
- No em-dash in comments, commit messages, or PR text; a plain hyphen is fine.
- No `RFC-NNN` references in code comments; state the reasoning inline.

Contracts

- `contracts/` is generated upstream; never edit it here. A change that needs
  a new contract field waits for the upstream contract release, or the PR
  names the follow-up.

Verify

- `pnpm typecheck` and `pnpm test` are green.
- Tests added for the new behavior, including the negative case.
- `git diff` read end to end: no stray formatting, no unrelated files, no
  debug logging.

PR text

- Body states the problem, the change, and how it was verified. Cross-repo
  companions linked as `owner/repo#N`.

# Contract inputs and generated SDKs

This repository consumes immutable contract snapshots copied from Edge by the
private repository's release sync workflow. Do not modify files under
`contracts/` in this repository. Each copied contract subtree has a
`release.json` file recording the source Edge tag and commit.

`contracts/edge-public/v1/openapi.json` is the REST control-plane source. The
CI workflow generates TypeScript, Python, and Go clients from it. The existing
ComputeSDK provider is the handwritten TypeScript façade over that generated
surface and sandboxd's generated RPC bindings.

`contracts/sandboxd` is the independent Buf module for the direct data plane.
It is linted and generated in CI from its pinned `buf.gen.yaml` template.

REST and sandboxd releases are intentionally independent: a release of either
contract validates only its own generated artifacts, while provider validation
always runs. Generated artifacts are deliberately created in CI and uploaded
to language-package release jobs. A contract change is not released until the
public API compatibility gate in Edge has passed and its relevant generation
and package tests have passed.

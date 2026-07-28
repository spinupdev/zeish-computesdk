# Contract inputs and generated SDKs

This repository consumes immutable contract snapshots copied from Edge by the
private repository's sync workflow. Do not modify files under `contracts/` in
this repository.

`contracts/edge-public/v1/openapi.json` is the REST control-plane source. The
CI workflow generates TypeScript, Python, and Go clients from it. The existing
ComputeSDK provider is the handwritten TypeScript façade over that generated
surface and sandboxd's generated RPC bindings.

`contracts/sandboxd` is the independent Buf module for the direct data plane.
It is linted and generated in CI from its pinned `buf.gen.yaml` template.

Generated artifacts are deliberately created in CI and uploaded to language
package release jobs. A contract change is not released until the public API
compatibility gate in Edge has passed, this workflow has generated every SDK,
and each package's test suite has passed.

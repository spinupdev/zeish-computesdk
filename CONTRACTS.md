# Contract inputs and generated SDKs

This repository consumes immutable contract snapshots copied from the
control plane by the private repository's release sync workflow. Do not
modify files under `contracts/` in this repository. Each copied contract
subtree has a `release.json` file recording the source control-plane tag
and commit.

`contracts/zeish-public/v1/openapi.json` is the REST control-plane source. The
CI workflow generates TypeScript, Python, and Go clients from it. The existing
ComputeSDK provider is the handwritten TypeScript façade over that generated
surface and sandboxd's generated RPC bindings.

`contracts/sandboxd` is the independent Buf module for the direct data plane.
It is linted and generated in CI from its pinned `buf.gen.yaml` template for
TypeScript, Python, and Go.

REST and sandboxd releases are intentionally independent: a release of either
contract validates only its own generated artifacts, while provider validation
always runs. The REST release job generates named TypeScript, Python, and Go
packages, compiles TypeScript, runs Python's generated suite, and runs Go's
generated suite before uploading language artifacts and generated docs. A
manual public release can publish the TypeScript and Python packages only after
those same gates succeed; it requires `NPM_TOKEN` and `PYPI_TOKEN` respectively.
The Go artifact is a versioned source archive until a dedicated Go module
repository or a committed `go/` module is selected. A contract change is not
released until the public API compatibility gate in the control plane has
passed and its relevant generation and package tests have passed.

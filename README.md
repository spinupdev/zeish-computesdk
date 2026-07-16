# Zeish ComputeSDK provider

An open-source ComputeSDK provider for Zeish. It implements sandbox lifecycle,
preview URLs, streaming command execution, snapshot creation, and direct
sandboxd filesystem operations.

```ts
import { zeish } from '@zeish/computesdk-provider';
const compute = zeish({ apiKey: process.env.ZEISH_API_KEY! });
```

New `zeish_live_…` keys are standalone and need no extra identity headers.
The optional `externalIdentity` setting only supports legacy Arin-bound keys.

## Status

This is an early provider release. `runCommand()` streams sandboxd stdout and
stderr callbacks through `ExecStream`; the deployed data plane must include
Depot's matching gRPC route before it can be used in production.

ComputeSDK's provider interface has no sandbox-scoped snapshot-list/delete
operation, while Zeish intentionally keeps those snapshot endpoints
sandbox-scoped. Those two methods therefore remain unavailable through the
provider; use Zeish REST for them.

## License

MIT

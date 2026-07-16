# Zeish ComputeSDK provider

An open-source ComputeSDK provider for Zeish. It implements sandbox lifecycle,
preview URLs, snapshot creation, and direct sandboxd filesystem operations.
Command execution will use Depot's new streaming `ExecStream` gRPC transport
once that data-plane deployment is available.

```ts
import { zeish } from '@zeish/computesdk-provider';
const compute = zeish({ apiKey: process.env.ZEISH_API_KEY! });
```

New `zeish_live_…` keys are standalone and need no extra identity headers.
The optional `externalIdentity` setting only supports legacy Arin-bound keys.

## Status

This is an early provider release. ComputeSDK’s provider interface has no
sandbox-scoped snapshot-list/delete operation, while Zeish intentionally keeps
those snapshot endpoints sandbox-scoped. Those two methods therefore remain
unavailable through the provider; use Zeish REST for them.

## License

MIT

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

## First-party sandbox client

`createZeishSandboxClient()` is the provider-neutral integration interface for
agents such as Arin. It keeps Edge's control plane and sandboxd data plane
together: create a sandbox, wait for scoped access, then use commands, files,
lifecycle operations, logs, events, previews, sandbox-scoped snapshots, and
guest display actions from one session object.

```ts
import { createZeishSandboxClient } from '@zeish/computesdk-provider';

const edge = createZeishSandboxClient({
  apiKey: process.env.ZEISH_API_KEY!,
  defaultTemplateId: process.env.ARIN_SANDBOX_TEMPLATE!,
});

const sandbox = await edge.create({
  name: `arin-run-${runId}`,
  templateId: process.env.ARIN_SANDBOX_TEMPLATE!,
  metadata: { arinRunId: runId, arinAgentId: agentId },
});

await sandbox.waitForAccess();
const result = await sandbox.run('node worker.js', {
  workingDirectory: '/workspace',
  onStdout: writeRunLog,
  onStderr: writeRunLog,
});
await sandbox.files.writeText('/workspace/input.json', JSON.stringify(input));
const png = await sandbox.screenshot();
await sandbox.act({ type: 'click', x: 340, y: 210 });
await sandbox.destroy();
```

`screenshot()` and `act()` call sandboxd's authenticated display endpoints.
Use a desktop-capable template that exposes a compatible display: sandboxd's
current input/capture implementation targets X11, so a Wayland-only template
needs Xwayland enabled or sandboxd's Wayland backend before cursor control is
available.

## License

MIT

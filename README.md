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
const png = await sandbox.desktop.screenshot();
await sandbox.desktop.move(340, 210);
await sandbox.desktop.click({ x: 340, y: 210 });
await sandbox.desktop.type('hello');
await sandbox.desktop.key('ENTER');
await sandbox.destroy();
```

`desktop` calls sandboxd's authenticated native Wayland display endpoints.
It supports screenshots plus move, click, scroll, text, and named key actions
through the desktop-agentd privilege boundary; X11 and Xwayland are not
required.

## Agent / CDP contracts (prevents common 400s)

Helpers encode Edge rules so clients do not rediscover them:

```ts
import {
  createZeishApi,
  createAndStartSandbox,
  waitUntilRunning,
  isTerminalSandboxStatus,
  PREVIEW_CODE_TTL_AGENT,
  CHROME_CDP_PORT,
  clampPreviewTtlSeconds,
} from '@zeish/computesdk-provider';

const api = createZeishApi({ apiKey: process.env.ZEISH_API_KEY! });

// create → start → wait; destroy + retry on status failed
const sandbox = await createAndStartSandbox(api, {
  name: 'agent-run',
  templateId: process.env.ZEISH_TEMPLATE_ID!,
  exposedPorts: [CHROME_CDP_PORT], // 9222 for Chromium CDP
  labels: { arin: '1' },
});

// ttl_seconds is clamped client-side to Edge max (1..3600)
const preview = await api.createPreviewCode(sandbox.id, {
  port: CHROME_CDP_PORT,
  ttl_seconds: PREVIEW_CODE_TTL_AGENT,
});
```

| Rule | Helper / constant |
|---|---|
| `ttl_seconds` 1..3600 | `clampPreviewTtlSeconds`, auto-clamp in `createPreviewCode` |
| Terminal includes **`failed`** | `isTerminalSandboxStatus` |
| Flaky create | `createAndStartSandbox` (destroy + retry) |
| CDP port exposure | `exposedPorts: [CHROME_CDP_PORT]` |

`ZeishApiError` exposes `code`, `details`, and `isValidationError` for structured Edge envelopes.

## License

MIT

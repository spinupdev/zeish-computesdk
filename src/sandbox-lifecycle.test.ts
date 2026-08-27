import { describe, expect, it, vi } from "vitest";
import { createAndStartSandbox } from "./sandbox-lifecycle";
import type { ZeishPublicApi, ZeishSandbox } from "./zeish.types";

const sandbox = (status: "pending" | "running"): ZeishSandbox => ({
  id: "sandbox-1",
  organizationId: "org-1",
  name: "test",
  slug: "test",
  labels: {},
  status,
  driver: "firecracker",
  region: "bremen",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("createAndStartSandbox", () => {
  it("shares declared public ports after the sandbox is running", async () => {
    const sharePort = vi.fn().mockResolvedValue(sandbox("running"));
    const getSandbox = vi.fn().mockResolvedValue(sandbox("running"));
    const api = {
      createSandbox: vi.fn().mockResolvedValue(sandbox("pending")),
      getSandbox,
      sharePort,
    } as unknown as ZeishPublicApi;

    await createAndStartSandbox(
      api,
      { name: "test", template: "template-1", ingress: [{ mode: "raw_l4", protocol: "tcp", internalPort: 3000 }] },
      { publicPorts: [3000], pollIntervalMs: 0 },
    );

    expect(sharePort).toHaveBeenCalledWith("sandbox-1", 3000, "public");
    expect(getSandbox).toHaveBeenCalledTimes(2);
  });
});

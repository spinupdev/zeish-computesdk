/**
 * Edge public API contracts that consumers must respect.
 * Keep in sync with edge/contracts/edge-public/v1/openapi.json and
 * sandboxes.service createPreviewCode validation.
 */

/** Minimum preview-code TTL (seconds). */
export const PREVIEW_CODE_TTL_MIN = 1;

/**
 * Maximum preview-code TTL (seconds).
 * Edge previously enforced 300; raised to 3600 for agent/CDP sessions.
 */
export const PREVIEW_CODE_TTL_MAX = 3600;

/** Default when caller omits ttl_seconds (5 minutes — good for short previews). */
export const PREVIEW_CODE_TTL_DEFAULT = 300;

/** Recommended TTL for Playwright CDP tunnels (must be ≤ PREVIEW_CODE_TTL_MAX). */
export const PREVIEW_CODE_TTL_AGENT = 3600;

/** Chromium remote-debugging port used by agent browser automation. */
export const CHROME_CDP_PORT = 9222;

/** Default attach / wait timeout for create+start. */
export const SANDBOX_READY_TIMEOUT_MS = 90_000;

/** Default poll interval while waiting for running. */
export const SANDBOX_READY_POLL_MS = 2_000;

/** Default create+start attempts when provisioning flakes. */
export const SANDBOX_ATTACH_MAX_ATTEMPTS = 3;

/**
 * Clamp ttl_seconds to Edge's allowed range.
 * Undefined → PREVIEW_CODE_TTL_DEFAULT.
 */
export function clampPreviewTtlSeconds(
  ttl: number | undefined,
  fallback: number = PREVIEW_CODE_TTL_DEFAULT,
): number {
  const raw =
    typeof ttl === "number" && Number.isFinite(ttl) ? Math.floor(ttl) : fallback;
  if (raw < PREVIEW_CODE_TTL_MIN) return PREVIEW_CODE_TTL_MIN;
  if (raw > PREVIEW_CODE_TTL_MAX) return PREVIEW_CODE_TTL_MAX;
  return raw;
}

/** Same 1..3600 range as preview codes — see CreateTunnelAccessSchema in edge. */
export const TUNNEL_ACCESS_TTL_MIN = 1;
export const TUNNEL_ACCESS_TTL_MAX = 3600;

/** Default when caller omits ttl_seconds for tunnel access (1 minute). */
export const TUNNEL_ACCESS_TTL_DEFAULT = 60;

/** Recommended TTL for Playwright CDP tunnels (must be ≤ TUNNEL_ACCESS_TTL_MAX). */
export const TUNNEL_ACCESS_TTL_AGENT = 3600;

/**
 * Clamp ttl_seconds to Edge's tunnel-access allowed range.
 * Undefined → TUNNEL_ACCESS_TTL_DEFAULT.
 */
export function clampTunnelTtlSeconds(
  ttl: number | undefined,
  fallback: number = TUNNEL_ACCESS_TTL_DEFAULT,
): number {
  const raw =
    typeof ttl === "number" && Number.isFinite(ttl) ? Math.floor(ttl) : fallback;
  if (raw < TUNNEL_ACCESS_TTL_MIN) return TUNNEL_ACCESS_TTL_MIN;
  if (raw > TUNNEL_ACCESS_TTL_MAX) return TUNNEL_ACCESS_TTL_MAX;
  return raw;
}

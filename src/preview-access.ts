/**
 * Preview URL auth helpers (proxyd / Edge public PreviewCode contract).
 *
 * Edge `POST …/preview-codes` returns (v1 additive fields):
 *   url / handoff_url — browser cookie handoff at /_depot/auth?code=…
 *   base_url          — clean origin for agents (Bearer / ?token=)
 *   code, expires_at
 *
 * Server-side clients must use base_url + Bearer, never treat handoff `url`
 * as an HTTP base (that yields HTTP 401 under Node fetch / Playwright).
 *
 * Credential matrix (depot proxyd):
 *   - Authorization: Bearer <jwt>  → SDKs / server-to-server HTTP
 *   - ?token=<jwt> on WS upgrade   → clients that cannot set headers
 *   - GET /_depot/auth?code=       → browser cookie handoff only
 */

/** Wire envelope from Edge POST /preview-codes (snake_case public API). */
export interface ZeishPreviewCodeRaw {
  url: string;
  code: string;
  expires_at: string;
  /** Edge public field (preferred over deriving from handoff url). */
  base_url?: string;
  /** Edge public field; alias of url. */
  handoff_url?: string;
  /** Legacy / already-normalized camelCase. */
  baseUrl?: string;
  handoffUrl?: string;
}

/**
 * Normalized preview access for both browsers and agents (camelCase SDK).
 *
 * - `url` / `handoffUrl` — open in a browser (cookie handoff)
 * - `baseUrl` — clean origin for programmatic HTTP/WS (from Edge `base_url`)
 * - `code` / `token` — JWT for Bearer / ?token=
 * - `headers` — ready-to-use Authorization for fetch / Playwright
 */
export interface ZeishPreviewCode {
  url: string;
  code: string;
  expires_at: string;
  /** Same as `url` (explicit: browser-only handoff). */
  handoffUrl: string;
  /**
   * Clean preview origin, e.g. `https://{id}-9222-tcp.cbx-de-2.zei.sh`.
   * Use this (not `url`) for HTTP paths like `/json/version`.
   */
  baseUrl: string;
  /** Same as `code` (JWT). */
  token: string;
  /** `Authorization: Bearer <token>` (+ Accept) for server-to-server requests. */
  headers: Record<string, string>;
}

/**
 * Extract clean preview origin from an Edge handoff URL (or any absolute URL).
 */
export function previewOriginFromHandoffUrl(handoffUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(handoffUrl);
  } catch {
    throw new Error(
      `Invalid Zeish preview handoff url: ${handoffUrl.slice(0, 120)}`,
    );
  }
  return parsed.origin;
}

/** Authorization headers for proxyd private/org preview routes. */
export function previewAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

/**
 * Append or replace `?token=` on a URL (proxyd WebSocket clients).
 * Prefer Bearer headers for plain HTTP — query tokens on non-WS requests
 * cause a Set-Cookie + 302 that Node fetch does not retain.
 */
export function withPreviewAccessToken(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.toString();
}

/**
 * Map Edge's public PreviewCode (snake_case) to the SDK shape.
 * Prefers Edge `base_url` / `handoff_url`; falls back to parsing `url` for
 * older Edge deployments that only return url + code + expires_at.
 */
export function normalizePreviewCode(
  raw: ZeishPreviewCodeRaw | ZeishPreviewCode,
): ZeishPreviewCode {
  if (!raw.url || !raw.code) {
    throw new Error(
      "Zeish preview-code response missing url or code",
    );
  }
  const fromEdgeBase =
    ("base_url" in raw && typeof raw.base_url === "string" && raw.base_url) ||
    ("baseUrl" in raw && typeof raw.baseUrl === "string" && raw.baseUrl) ||
    "";
  const baseUrl = fromEdgeBase || previewOriginFromHandoffUrl(raw.url);
  const fromEdgeHandoff =
    ("handoff_url" in raw &&
      typeof raw.handoff_url === "string" &&
      raw.handoff_url) ||
    ("handoffUrl" in raw &&
      typeof raw.handoffUrl === "string" &&
      raw.handoffUrl) ||
    raw.url;
  const token = raw.code;
  return {
    url: raw.url,
    code: raw.code,
    expires_at: raw.expires_at,
    handoffUrl: fromEdgeHandoff,
    baseUrl,
    token,
    headers: previewAuthHeaders(token),
  };
}

/**
 * Rewrite Chrome's loopback `webSocketDebuggerUrl` onto the public preview host.
 * Attaches `?token=` so proxyd can authorize the WS upgrade.
 */
export function rewriteCdpWebSocketUrl(
  webSocketDebuggerUrl: string,
  previewBaseUrl: string,
  accessToken?: string,
): string {
  const preview = new URL(previewBaseUrl);
  const ws = new URL(webSocketDebuggerUrl);
  ws.protocol = preview.protocol === "https:" ? "wss:" : "ws:";
  ws.hostname = preview.hostname;
  ws.port = preview.port;
  if (accessToken) {
    return withPreviewAccessToken(ws.toString(), accessToken);
  }
  return ws.toString();
}

/**
 * Build a fully resolved CDP endpoint for Playwright `connectOverCDP`.
 * Call after Chrome is listening inside the sandbox and you have a preview code.
 */
export function resolveCdpEndpoint(options: {
  preview: ZeishPreviewCodeRaw | ZeishPreviewCode;
  /** From Chrome `/json/version` (use fetchPreviewJsonVersion). */
  webSocketDebuggerUrl: string;
}): {
  baseUrl: string;
  httpUrl: string;
  wsUrl: string;
  headers: Record<string, string>;
  token: string;
} {
  const preview = normalizePreviewCode(options.preview);
  return {
    baseUrl: preview.baseUrl,
    httpUrl: preview.baseUrl,
    wsUrl: rewriteCdpWebSocketUrl(
      options.webSocketDebuggerUrl,
      preview.baseUrl,
      preview.token,
    ),
    headers: preview.headers,
    token: preview.token,
  };
}

/**
 * GET `{baseUrl}/json/version` with Bearer auth (never hits /_depot/auth).
 */
export async function fetchPreviewJsonVersion(
  preview: ZeishPreviewCodeRaw | ZeishPreviewCode,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    path?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const access = normalizePreviewCode(preview);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("A Fetch API implementation is required for preview HTTP.");
  }
  const path = options.path ?? "/json/version";
  const url = `${access.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(url, {
        headers: access.headers,
        redirect: "manual",
      });
      if (res.ok) {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && !Array.isArray(body)) {
          return body as Record<string, unknown>;
        }
        lastErr = "non-object JSON body";
      } else {
        const text = await res.text().catch(() => "");
        lastErr = `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
        if (res.status === 401 || res.status === 403) {
          // Surface auth failures quickly; same JWT will not suddenly work.
          await sleep(200);
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }

  throw new Error(
    `Could not reach preview ${url}: ${lastErr}. ` +
      `Use preview.baseUrl + Bearer (preview.headers), not the /_depot/auth handoff URL.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

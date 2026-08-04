export type BrowserMediaAccess =
  | { status: "ready" }
  | { status: "unavailable"; reason: "cors_not_allowed" | "range_not_supported" | "unexpected_media_response" };

/**
 * A native <video> can play a private signed URL without CORS, but Canvas
 * cannot draw frames from it unless the object-store explicitly authorises
 * the dashboard origin. HVE composition preview must prove that contract
 * before mounting the canvas.
 */
export function assessBrowserMediaAccess(input: {
  status: number;
  contentType: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
  accessControlAllowOrigin: string | null;
  requestedOrigin: string;
}): BrowserMediaAccess {
  if (input.status !== 206 || !input.contentType?.toLowerCase().startsWith("video/")) {
    return { status: "unavailable", reason: "unexpected_media_response" };
  }
  const allowsOrigin = input.accessControlAllowOrigin === "*"
    || input.accessControlAllowOrigin === input.requestedOrigin;
  if (!allowsOrigin) return { status: "unavailable", reason: "cors_not_allowed" };
  const supportsRanges = input.acceptRanges?.toLowerCase().includes("bytes")
    && Boolean(input.contentRange?.toLowerCase().startsWith("bytes "));
  if (!supportsRanges) return { status: "unavailable", reason: "range_not_supported" };
  return { status: "ready" };
}

/**
 * Probe only one byte. The response body is always cancelled, so the control
 * plane never proxies or buffers a customer video merely to validate the
 * browser contract. The signed URL is intentionally absent from all logs.
 */
export async function verifySignedBrowserMediaAccess(input: {
  url: string;
  origin: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<BrowserMediaAccess> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000);
  try {
    const response = await fetchImpl(input.url, {
      method: "GET",
      headers: {
        Origin: input.origin,
        Range: "bytes=0-0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    await response.body?.cancel();
    return assessBrowserMediaAccess({
      status: response.status,
      contentType: response.headers.get("content-type"),
      acceptRanges: response.headers.get("accept-ranges"),
      contentRange: response.headers.get("content-range"),
      accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
      requestedOrigin: input.origin,
    });
  } catch {
    return { status: "unavailable", reason: "unexpected_media_response" };
  } finally {
    clearTimeout(timeout);
  }
}

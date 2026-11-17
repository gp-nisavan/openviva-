/**
 * API Route Helper for OpenViva.
 * Ensures all client-side fetch requests are prefixed with the deployment basePath (/openviva).
 */

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/openviva";

export function apiUrl(endpoint: string): string {
  // If already an absolute URL (e.g. http:// or https://), return as-is
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }

  // Ensure clean leading slash
  const clean = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // If already prefixed with basePath, return as-is to avoid duplicate prefixing
  if (clean.startsWith(`${BASE_PATH}/`) || clean === BASE_PATH) {
    return clean;
  }

  return `${BASE_PATH}${clean}`;
}

// Helper to determine if a relative path needs basePath prefixing
function shouldRewritePath(pathStr: string): boolean {
  return (
    pathStr.startsWith("/api/") ||
    pathStr.startsWith("api/") ||
    pathStr.startsWith("/models/") ||
    pathStr.startsWith("models/") ||
    pathStr.startsWith("/onnx-wasm/") ||
    pathStr.startsWith("onnx-wasm/")
  );
}

// Global browser fetch interceptor to guarantee 100% of all /api and static model calls are sub-path prefixed
if (typeof window !== "undefined" && !(window as any).__OPEN_VIVA_FETCH_PATCHED__) {
  (window as any).__OPEN_VIVA_FETCH_PATCHED__ = true;
  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    try {
      if (typeof input === "string") {
        if (shouldRewritePath(input)) {
          input = apiUrl(input);
        }
      } else if (input instanceof URL) {
        if (shouldRewritePath(input.pathname)) {
          input = new URL(apiUrl(input.pathname + input.search), input.origin);
        }
      } else if (typeof Request !== "undefined" && input instanceof Request) {
        try {
          const parsed = new URL(input.url);
          if (shouldRewritePath(parsed.pathname)) {
            const newPath = apiUrl(parsed.pathname + parsed.search);
            input = new Request(new URL(newPath, parsed.origin).toString(), input);
          }
        } catch (reqErr) {
          console.debug("[api] Request rewrite warning:", reqErr);
        }
      }
    } catch (fetchErr) {
      console.debug("[api] Fetch interceptor warning:", fetchErr);
    }
    return originalFetch.call(this, input, init);
  };
}

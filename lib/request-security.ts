function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originMatchesRequestHost(origin: string, request: Request): boolean {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host");
    return host !== null && originUrl.protocol === requestUrl.protocol && originUrl.host === host;
  } catch {
    return false;
  }
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = canonicalOrigin(request.url);
  return (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin)
    || originMatchesRequestHost(origin, request);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

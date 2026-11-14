// Next.js routes take precedence. Unknown paths belong to Orchard Core.
// Resolve the upstream at request time so a rebuilt image is environment-neutral.
export const dynamic = "force-dynamic";

async function proxy(request: Request): Promise<Response> {
  const configured = process.env.ORCHARD_PROXY_TARGET;
  if (!configured) return new Response("CMS proxy target is not configured", { status: 503 });

  let target: URL;
  try {
    target = new URL(configured);
    if (!(["http:", "https:"].includes(target.protocol)) || target.username || target.password) {
      throw new Error("Invalid CMS target");
    }
  } catch {
    return new Response("CMS proxy target is invalid", { status: 503 });
  }

  const incoming = new URL(request.url);
  const upstreamUrl = new URL(incoming.pathname + incoming.search, target);
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("host", incoming.host);
  headers.set("x-forwarded-host", incoming.host);
  if (!headers.has("x-forwarded-proto")) headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      cache: "no-store",
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding"); // Node fetch decodes upstream bodies.
    responseHeaders.delete("set-cookie");
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
    const location = responseHeaders.get("location");
    if (location) {
      try {
        const redirect = new URL(location, target);
        if (redirect.origin === target.origin) {
          responseHeaders.set("location", redirect.pathname + redirect.search + redirect.hash);
        }
      } catch { /* Preserve an already relative Location. */ }
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("CMS proxy request failed", error);
    return new Response("CMS is unavailable", { status: 502 });
  }
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };

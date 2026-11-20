// Next.js routes take precedence. Unknown paths belong to Orchard Core.
// Resolve the upstream at request time so a rebuilt image is environment-neutral.
export const dynamic = "force-dynamic";

// Branded RTL fallback for HTML navigations when the CMS is unreachable
// (audit UI-2: a bare "CMS is unavailable" string broke the product shell).
// API/asset requests keep a plain, cache-free error payload.
function cmsUnavailableHtml(): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سرویس مدیریت در دسترس نیست — AbrIT</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Vazirmatn, "Segoe UI", Tahoma, sans-serif;
    background: #0b1220; color: #f8fafc;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%;
    background: #111c31; border: 1px solid #26354d; border-radius: 16px;
    padding: 40px 32px; text-align: center;
  }
  .badge {
    width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 16px;
    background: rgba(29,78,216,.15); color: #60a5fa;
    display: flex; align-items: center; justify-content: center; font-size: 26px;
  }
  h1 { font-size: 18px; font-weight: 800; margin-bottom: 10px; }
  p { font-size: 13px; line-height: 2; color: #94a3b8; margin-bottom: 24px; }
  a {
    display: inline-block; background: #1d4ed8; color: #f8fafc;
    text-decoration: none; font-size: 13px; font-weight: 700;
    padding: 10px 24px; border-radius: 10px;
  }
  a:hover { background: #2563eb; }
  .hint { font-size: 11px; color: #64748b; margin-top: 16px; }
</style>
</head>
<body>
  <main class="card">
    <div class="badge">⚙️</div>
    <h1>سرویس مدیریت موقتاً در دسترس نیست</h1>
    <p>پنل مدیریت AbrIT پاسخ نمی‌دهد. لطفاً چند لحظه بعد دوباره تلاش کنید؛ اگر مشکل ادامه داشت با پشتیبانی تماس بگیرید.</p>
    <a href="/" >بازگشت به صفحه اصلی</a>
    <p class="hint">کد خطا: CMS_UNAVAILABLE</p>
  </main>
</body>
</html>`;
}

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

  const acceptsHtml = (request.headers.get("accept") ?? "").includes("text/html");

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
    // Branded fallback for browser navigations; plain payload for anything else.
    if (acceptsHtml) {
      return new Response(cmsUnavailableHtml(), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return new Response("CMS is unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };

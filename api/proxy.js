// api/proxy.js
// Vercel Edge Function Proxy for Roogle Cloud Lineup

export const config = {
  runtime: "edge",
};

const RECAPTCHA_WORKER = "https://recaptcha.uraverageopdoge.workers.dev";

export default async function handler(req) {
  const { searchParams, pathname } = new URL(req.url);

  // Only allow /api/proxy?url=...
  if (pathname.endsWith("/proxy") && searchParams.has("url")) {
    const target = searchParams.get("url");
    return handleProxy(target);
  }

  return new Response("Use /api/proxy?url=https://example.com", { status: 400 });
}

async function handleProxy(target) {
  try {
    const headers = new Headers();
    headers.set("User-Agent", randomUserAgent());
    headers.set("Accept-Language", randomAcceptLang());
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    headers.set("Referer", new URL(target).origin + "/");
    headers.set("Sec-Fetch-Site", "none");
    headers.set("Sec-Fetch-Mode", "navigate");
    headers.set("Sec-Fetch-User", "?1");
    headers.set("Sec-Fetch-Dest", "document");
    headers.set("Upgrade-Insecure-Requests", "1");

    const upstream = await fetch(target, { method: "GET", headers, redirect: "follow" });
    const contentType = upstream.headers.get("content-type") || "";

    // If blocked or rate-limited
    if (upstream.status === 429 || upstream.status === 403) {
      const redirectUrl = `${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`;
      return Response.redirect(redirectUrl, 302);
    }

    const bodyText = contentType.includes("text") ? await upstream.text() : null;

    // Detect captchas
    if (
      bodyText &&
      (bodyText.includes("recaptcha/api.js") ||
        bodyText.includes("Our systems have detected unusual traffic") ||
        bodyText.includes("detected unusual traffic from your computer network") ||
        bodyText.includes("To continue, please type the characters you see"))
    ) {
      const redirectUrl = `${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`;
      return Response.redirect(redirectUrl, 302);
    }

    // Clone and modify headers
    const outHeaders = new Headers(upstream.headers);
    stripSecurityHeaders(outHeaders);
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "*");
    outHeaders.set("X-Proxied-By", "Roogle Vercel Proxy");

    // Inject <base> if HTML
    if (contentType.includes("text/html") && bodyText !== null) {
      const base = `<base href="${new URL(target).origin}/">`;
      const rewritten = bodyText.replace(/<head([^>]*)>/i, (m) => `${m}${base}`);
      return new Response(rewritten, { status: 200, headers: outHeaders });
    }

    // Return normal response
    return new Response(bodyText === null ? upstream.body : bodyText, {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (err) {
    return new Response("Proxy failed: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
    });
  }
}

/* -------------------- HELPERS -------------------- */
function stripSecurityHeaders(headers) {
  [
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "frame-options",
    "cross-origin-embedder-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ].forEach((h) => headers.delete(h));
}

function randomAcceptLang() {
  const langs = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.8",
    "en;q=0.7",
    "en-US,en-CA;q=0.8",
  ];
  return langs[Math.floor(Math.random() * langs.length)];
}

function randomUserAgent() {
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

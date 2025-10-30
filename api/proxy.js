// api/proxy.js
// Roogle Vercel Backend Proxy (with full HTML URL rewriting)

export const config = {
  runtime: "edge",
};

const RECAPTCHA_WORKER = "https://recaptcha.uraverageopdoge.workers.dev";
const SELF_BASE = "https://vercelbackend1.vercel.app/api/proxy?url="; // <— change if your domain changes

export default async function handler(req) {
  const url = new URL(req.url);
  const { searchParams, pathname } = url;

  // handle both /proxy and /api/proxy paths
  if ((pathname.endsWith("/proxy") || pathname.endsWith("/api/proxy")) && searchParams.has("url")) {
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
    headers.set("Upgrade-Insecure-Requests", "1");

    const upstream = await fetch(target, { headers, redirect: "follow" });
    const contentType = upstream.headers.get("content-type") || "";
    const status = upstream.status;

    // Redirect to recaptcha handler if blocked
    if (status === 429 || status === 403) {
      return Response.redirect(`${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`, 302);
    }

    const bodyText = contentType.includes("text") ? await upstream.text() : null;

    // Detect captcha pages
    if (
      bodyText &&
      (bodyText.includes("recaptcha/api.js") ||
        bodyText.includes("detected unusual traffic") ||
        bodyText.includes("To continue, please type the characters you see"))
    ) {
      return Response.redirect(`${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`, 302);
    }

    // Copy headers but strip security
    const outHeaders = new Headers(upstream.headers);
    stripSecurityHeaders(outHeaders);
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "*");
    outHeaders.set("X-Proxied-By", "Roogle Vercel Proxy");

    // If HTML, inject <base> and rewrite URLs
    if (contentType.includes("text/html") && bodyText) {
      const baseTag = `<base href="${new URL(target).origin}/">`;
      let rewritten = bodyText.replace(/<head([^>]*)>/i, (m) => `${m}${baseTag}`);

      // Rewrite <a href="">
      rewritten = rewritten.replace(
        /href="(https?:\/\/[^"]+)"/gi,
        (m, p1) => `href="${SELF_BASE}${encodeURIComponent(p1)}"`
      );

      // Rewrite relative links like /search or /imgres
      rewritten = rewritten.replace(
        /href="(\/[^"]*)"/gi,
        (m, p1) => `href="${SELF_BASE}${encodeURIComponent(new URL(p1, target).href)}"`
      );

      // Rewrite forms (like Google’s search bar)
      rewritten = rewritten.replace(
        /<form([^>]*?)action="([^"]*)"([^>]*)>/gi,
        (m, pre, act, post) => {
          const proxied = act.startsWith("http")
            ? `${SELF_BASE}${encodeURIComponent(act)}`
            : `${SELF_BASE}${encodeURIComponent(new URL(act, target).href)}`;
          return `<form${pre}action="${proxied}"${post}>`;
        }
      );

      return new Response(rewritten, { status, headers: outHeaders });
    }

    // Non-HTML (JS/CSS/images)
    return new Response(bodyText === null ? upstream.body : bodyText, { status, headers: outHeaders });
  } catch (err) {
    return new Response("Proxy failed: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
    });
  }
}

/* ---------- Helpers ---------- */
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
  const langs = ["en-US,en;q=0.9", "en-GB,en;q=0.8", "en;q=0.7", "en-US,en-CA;q=0.8"];
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

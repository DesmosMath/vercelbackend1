// api/proxy.js
// Roogle Vercel Backend Proxy (GET + POST, Google-safe, HTML rewriting + redirect fix)

export const config = {
  runtime: "edge",
};

const RECAPTCHA_WORKER = "https://recaptcha.uraverageopdoge.workers.dev";
const SELF_BASE = "https://vercelbackend1.vercel.app/proxy?url="; // update if domain changes

export default async function handler(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const target = url.searchParams.get("url");

  // Works for both /proxy and /api/proxy, even with or without trailing slashes
  const isProxyRoute =
    pathname.endsWith("/proxy") ||
    pathname.endsWith("/api/proxy") ||
    pathname === "/proxy" ||
    pathname === "/api/proxy";

  if (isProxyRoute && target) {
    return handleProxy(req, target);
  }

  return new Response("Missing or invalid ?url= parameter.", { status: 400 });
}

async function handleProxy(req, target) {
  try {
    const method = req.method || "GET";
    const headers = new Headers(req.headers);

    // Sanitize headers
    headers.set("User-Agent", randomUserAgent());
    headers.set("Accept-Language", randomAcceptLang());
    headers.delete("host");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");

    const fetchOpts = { method, headers, redirect: "manual" };

    if (method === "POST") {
      const body = await req.text();
      fetchOpts.body = body;
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }

    const upstream = await fetch(target, fetchOpts);
    const contentType = upstream.headers.get("content-type") || "";
    const status = upstream.status;

    // Handle redirects (Google search fix)
    if (status >= 300 && status < 400 && upstream.headers.get("location")) {
      const loc = upstream.headers.get("location");
      const proxied = `${SELF_BASE}${encodeURIComponent(
        new URL(loc, target).href
      )}`;
      return Response.redirect(proxied, 302);
    }

    // Handle CAPTCHA redirects
    if (status === 429 || status === 403) {
      return Response.redirect(
        `${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`,
        302
      );
    }

    const bodyText =
      contentType.includes("text") || contentType.includes("json")
        ? await upstream.text()
        : null;

    // Detect CAPTCHA page content
    if (
      bodyText &&
      (bodyText.includes("recaptcha/api.js") ||
        bodyText.includes("unusual traffic") ||
        bodyText.includes("type the characters you see"))
    ) {
      return Response.redirect(
        `${RECAPTCHA_WORKER}/?url=${encodeURIComponent(target)}`,
        302
      );
    }

    // Copy and clean headers
    const outHeaders = new Headers(upstream.headers);
    stripSecurityHeaders(outHeaders);
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "*");
    outHeaders.set("X-Proxied-By", "Roogle Vercel Proxy");

    // If HTML → inject <base> and rewrite URLs
    if (contentType.includes("text/html") && bodyText) {
      const baseTag = `<base href="${new URL(target).origin}/">`;
      const injectScriptTag = `<script src="/api/inject.js" async></script>`;
      let rewritten = bodyText.replace(
        /<head([^>]*)>/i,
        (m) => `${m}${baseTag}${injectScriptTag}`
      );

      // Rewrite links (href + src)
      rewritten = rewritten
        .replace(/(href|src)="(https?:\/\/[^"]+)"/gi, (_, attr, link) => {
          return `${attr}="${SELF_BASE}${encodeURIComponent(link)}"`;
        })
        .replace(/(href|src)="\/([^"]*)"/gi, (_, attr, path) => {
          return `${attr}="${SELF_BASE}${encodeURIComponent(
            new URL("/" + path, target).href
          )}"`;
        });

      // Rewrite forms (like Google search)
      rewritten = rewritten.replace(
        /<form([^>]*?)action="([^"]*)"([^>]*)>/gi,
        (m, pre, act, post) => {
          const absolute = act.startsWith("http")
            ? act
            : new URL(act, target).href;
          const proxied = `${SELF_BASE}${encodeURIComponent(absolute)}`;
          return `<form${pre}action="${proxied}"${post}>`;
        }
      );

      return new Response(rewritten, { status, headers: outHeaders });
    }

    // Non-HTML (CSS, JS, images, etc.)
    return new Response(bodyText === null ? upstream.body : bodyText, {
      status,
      headers: outHeaders,
    });
  } catch (err) {
    return new Response("Proxy failed: " + err.message, {
      status: 502,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
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

// api/proxy.js
// Roogle Vercel Backend Proxy (GET + POST, Google-safe, supports /proxy and /api/proxy)

export const config = {
  runtime: "edge",
};

// --- Config ---
const RECAPTCHA_WORKER = "https://recaptcha.uraverageopdoge.workers.dev";

// ✅ Use /api/proxy by default, fallback to /proxy for manual calls
const BASE_DOMAIN = "https://vercelbackend1.vercel.app";
const SELF_BASE_API = `${BASE_DOMAIN}/api/proxy?url=`;
const SELF_BASE_ALT = `${BASE_DOMAIN}/proxy?url=`;

// --- Main handler ---
export default async function handler(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const target = url.searchParams.get("url");

  const isProxyRoute =
    pathname.endsWith("/proxy") ||
    pathname.endsWith("/api/proxy") ||
    pathname === "/proxy" ||
    pathname === "/api/proxy";

  if (isProxyRoute) {
    if (target) return handleProxy(req, target);

    // Auto-handle Google search ?q=
    const query = url.searchParams.get("q");
    if (query) {
      const googleSearch = "https://www.google.com/search?q=" + encodeURIComponent(query);
      return handleProxy(req, googleSearch);
    }

    return new Response("Use /api/proxy?url=https://example.com", { status: 400 });
  }

  // Fallback message if route not matched
  return new Response("Not a valid Roogle proxy route", { status: 404 });
}

// --- Proxy core logic ---
async function handleProxy(req, target) {
  try {
    const method = req.method || "GET";
    const headers = new Headers(req.headers);

    // Header cleanup
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

    // Redirects
    if (status >= 300 && status < 400 && upstream.headers.get("location")) {
      const loc = upstream.headers.get("location");
      const proxied = `${SELF_BASE_API}${encodeURIComponent(new URL(loc, target).href)}`;
      return Response.redirect(proxied, 302);
    }

    // CAPTCHA & rate limits
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

    // Detect CAPTCHA HTML
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

    // Clone and sanitize headers
    const outHeaders = new Headers(upstream.headers);
    stripSecurityHeaders(outHeaders);
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "*");
    outHeaders.set("X-Proxied-By", "Roogle Vercel Proxy");

    // --- HTML rewriting (Google-safe) ---
    if (contentType.includes("text/html") && bodyText) {
      const baseTag = `<base href="${new URL(target).origin}/">`;
      const injectScriptTag = `<script src="/api/inject.js" async></script>`;
      let rewritten = bodyText.replace(
        /<head([^>]*)>/i,
        (m) => `${m}${baseTag}${injectScriptTag}`
      );

      // Rewrite href/src
      rewritten = rewritten
        .replace(/(href|src)="(https?:\/\/[^"]+)"/gi, (_, attr, link) =>
          `${attr}="${SELF_BASE_API}${encodeURIComponent(link)}"`
        )
        .replace(/(href|src)="\/([^"]*)"/gi, (_, attr, path) =>
          `${attr}="${SELF_BASE_API}${encodeURIComponent(new URL("/" + path, target).href)}"`
        );

      // Rewrite form actions (like Google search)
      rewritten = rewritten.replace(
        /<form([^>]*?)action="([^"]*)"([^>]*)>/gi,
        (m, pre, act, post) => {
          const absolute = act.startsWith("http")
            ? act
            : new URL(act, target).href;
          const proxied = `${SELF_BASE_API}${encodeURIComponent(absolute)}`;
          return `<form${pre}action="${proxied}"${post}>`;
        }
      );
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

// Catch JS-based redirects (window.location, top.location, etc.)
rewritten = rewritten.replace(
  /window\.location(\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
  (m, _, link) => `window.location.href="${SELF_BASE}${encodeURIComponent(link)}"`
);

      return new Response(rewritten, { status, headers: outHeaders });
    }

    // --- Non-HTML assets ---
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

// --- Helper Functions ---
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

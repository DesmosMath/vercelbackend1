// api/inject.js
// Client-side injection script for Roogle proxy.
// Runs inside proxied pages and forces in-page navigation/links/forms to use the proxy.

(function () {
  try {
    const PROXY_PREFIX = `${location.origin}/proxy?url=`; // uses the proxy path on the same origin
    const baseEl = document.querySelector('base');
    const ORIGINAL_BASE = (baseEl && baseEl.href) || window.location.origin + '/';

    function absoluteUrl(href) {
      try {
        return new URL(href, ORIGINAL_BASE).href;
      } catch (e) {
        return null;
      }
    }

    function proxifyUrl(href) {
      const abs = absoluteUrl(href);
      if (!abs) return href;
      // If href already points to our proxy, leave it
      if (abs.startsWith(location.origin) && abs.includes('/proxy?url=')) return href;
      return PROXY_PREFIX + encodeURIComponent(abs);
    }

    function rewriteAttributes(node) {
      if (!node || node.nodeType !== 1) return;
      // href, src, action, srcset, poster
      if (node.hasAttribute('href')) {
        const v = node.getAttribute('href');
        if (v && !v.startsWith('javascript:') && !v.startsWith('#')) {
          node.setAttribute('href', proxifyUrl(v));
        }
      }
      if (node.hasAttribute('src')) {
        const v = node.getAttribute('src');
        if (v) node.setAttribute('src', proxifyUrl(v));
      }
      if (node.hasAttribute('action')) {
        const v = node.getAttribute('action') || '';
        // keep blank action as current page proxied URL
        const abs = v.trim() === '' ? window.location.href : absoluteUrl(v);
        if (abs) node.setAttribute('action', PROXY_PREFIX + encodeURIComponent(abs));
      }
      if (node.hasAttribute('srcset')) {
        const v = node.getAttribute('srcset');
        if (v) {
          // simple srcset rewrite
          const rewritten = v
            .split(',')
            .map((part) => {
              const [urlPart, descriptor] = part.trim().split(/\s+/, 2);
              const p = proxifyUrl(urlPart);
              return descriptor ? `${p} ${descriptor}` : p;
            })
            .join(', ');
          node.setAttribute('srcset', rewritten);
        }
      }
      if (node.hasAttribute('poster')) {
        const v = node.getAttribute('poster');
        if (v) node.setAttribute('poster', proxifyUrl(v));
      }
    }

    function rewriteAll() {
      try {
        // links
        document.querySelectorAll('a[href]').forEach((a) => rewriteAttributes(a));
        // forms
        document.querySelectorAll('form[action]').forEach((f) => rewriteAttributes(f));
        // images, scripts, iframes, link rel=stylesheet
        document.querySelectorAll('img[src], script[src], iframe[src], link[href]').forEach((n) =>
          rewriteAttributes(n)
        );
      } catch (e) {
        // ignore
      }
    }

    // Intercept clicks on anchors to ensure proxy is used (some sites use onClick navigation)
    document.addEventListener(
      'click',
      (ev) => {
        const a = ev.target.closest && ev.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // If already proxied, let it be
        if (href.includes('/proxy?url=')) return;
        // Prevent default and navigate to proxied
        ev.preventDefault();
        const prox = proxifyUrl(href);
        location.href = prox;
      },
      true
    );

    // Intercept form submissions to keep them proxied (for JS submission too)
    document.addEventListener(
      'submit',
      (ev) => {
        const form = ev.target;
        if (!form || !form.action) return;
        // If action already proxied, allow
        if (form.action.includes('/proxy?url=')) return;
        // rewrite and allow submit
        form.action = PROXY_PREFIX + encodeURIComponent(absoluteUrl(form.action || window.location.href));
      },
      true
    );

    // Override history.pushState / replaceState and location.assign / location.replace / location.href setter
    (function () {
      const _push = history.pushState;
      history.pushState = function (state, title, url) {
        if (url) {
          try {
            const abs = absoluteUrl(url);
            if (abs && !abs.includes(location.origin + '/proxy?url=')) {
              url = PROXY_PREFIX + encodeURIComponent(abs);
            }
          } catch (e) {}
        }
        return _push.apply(this, [state, title, url]);
      };

      const _replace = history.replaceState;
      history.replaceState = function (state, title, url) {
        if (url) {
          try {
            const abs = absoluteUrl(url);
            if (abs && !abs.includes(location.origin + '/proxy?url=')) {
              url = PROXY_PREFIX + encodeURIComponent(abs);
            }
          } catch (e) {}
        }
        return _replace.apply(this, [state, title, url]);
      };

      const locDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href') ||
        Object.getOwnPropertyDescriptor(window.location.__proto__, 'href');

      try {
        // override location.assign and replace
        const origAssign = location.assign;
        location.assign = function (u) {
          const abs = absoluteUrl(u);
          return origAssign.call(location, abs ? PROXY_PREFIX + encodeURIComponent(abs) : u);
        };
        const origReplace = location.replace;
        location.replace = function (u) {
          const abs = absoluteUrl(u);
          return origReplace.call(location, abs ? PROXY_PREFIX + encodeURIComponent(abs) : u);
        };
      } catch (e) {
        // some environments don't allow overriding
      }
    })();

    // Observe DOM mutations and rewrite new items
    const mo = new MutationObserver((mutations) => {
      try {
        for (const m of mutations) {
          m.addedNodes && m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            // rewrite this node and its children lazily
            rewriteAttributes(n);
            n.querySelectorAll && n.querySelectorAll('[href],[src],[action]').forEach((c) => rewriteAttributes(c));
          });
          // attribute changes
          if (m.type === 'attributes') rewriteAttributes(m.target);
        }
      } catch (e) {}
    });

    mo.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'action', 'srcset', 'poster'],
    });

    // Run initial rewrite on load + a delayed pass (for SPA apps that mutate after load)
    function initial() {
      rewriteAll();
      setTimeout(rewriteAll, 500);
      setTimeout(rewriteAll, 2000);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initial);
    } else {
      initial();
    }

    // small debug helper (optional) - can be removed in production
    // console.info('Roogle inject running — proxy prefix:', PROXY_PREFIX, 'original base:', ORIGINAL_BASE);
  } catch (e) {
    // swallow errors — injection must not break the page
    console.error('Roogle inject error', e);
  }
})();

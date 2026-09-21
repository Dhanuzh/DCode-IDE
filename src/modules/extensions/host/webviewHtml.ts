import { convertFileSrc } from "@tauri-apps/api/core";
import {
  themeBodyClass,
  themeStyleTag,
  THEME_STYLE_ID,
  webviewThemeCss,
  type WebviewThemeInput,
} from "./webviewTheme";
/**
 * VS Code webviews reference their own bundled files and talk to the extension
 * through `acquireVsCodeApi()`. Neither exists in a plain iframe, so the HTML
 * is rewritten before it is injected.
 */

/** Custom scheme the app serves extension webview documents and assets from. */
export const WEBVIEW_SCHEME = "dcode-webview";

const RESOURCE_RE = /dcode-resource:([^"'`)\s;]+)/g;
// A CSP value contains single quotes (`'none'`, `'nonce-…'`), so the closing
// quote has to be matched by backreference rather than a negated class.
const CSP_META_RE =
  /(<meta[^>]*?http-equiv=["']?Content-Security-Policy["']?[^>]*?content=)(["'])([\s\S]*?)\2/i;
const NONCE_RE = /'nonce-([A-Za-z0-9+/=_-]+)'/;

/** The origin `convertFileSrc` produces, which differs per platform. */
export function assetOriginFrom(toAssetUrl: (path: string) => string): string {
  const sample = toAssetUrl("/dcode-probe");
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(sample);
  return match ? match[0] : "";
}

// Inlined fonts and images are ordinary in webview bundles, and a page whose
// CSP predates our asset origin would otherwise drop them silently.
const DATA_DIRECTIVES = ["font-src", "img-src", "media-src"];
// Everything the app serves the page itself (the icon font and its stylesheet)
// comes from the webview origin.
const ORIGIN_DIRECTIVES = ["font-src", "img-src", "media-src", "style-src"];

function addSource(directive: string, source: string): string {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(directive)
    ? directive
    : `${directive} ${source}`;
}

/** Allows inlined assets and the app's own webview origin where they are used. */
export function relaxCsp(csp: string, assetOrigin: string): string {
  return csp
    .split(";")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const name = trimmed.split(/\s+/)[0].toLowerCase();
      let next = part;
      if (DATA_DIRECTIVES.includes(name)) next = addSource(next, "data:");
      if (assetOrigin && ORIGIN_DIRECTIVES.includes(name)) {
        next = addSource(next, assetOrigin);
      }
      return next;
    })
    .join(";");
}

/**
 * The page's own CSP names `dcode-resource:` (our legacy `cspSource`). Point
 * those at the real asset origin, and make sure the origin itself is allowed
 * even when the HTML was built before the host knew it.
 */
export function rewriteCsp(html: string, assetOrigin: string): string {
  return html.replace(
    CSP_META_RE,
    (_match, open: string, quote: string, content: string) => {
      const patched = relaxCsp(
        content.replace(/dcode-resource:/g, assetOrigin || "'self'"),
        assetOrigin,
      );
      return `${open}${quote}${patched}${quote}`;
    },
  );
}

/** Webviews nonce their scripts; the injected bridge needs the same nonce. */
export function extractNonce(html: string): string | null {
  const csp = CSP_META_RE.exec(html);
  const source = csp ? csp[3] : html;
  const match = NONCE_RE.exec(source);
  return match ? match[1] : null;
}

/**
 * Extensions write `dcode-resource:<abs path>` (our `asWebviewUri`). Only the
 * app knows how to turn a path into a loadable URL, so it maps them here.
 */
export function rewriteResourceUris(
  html: string,
  toAssetUrl: (path: string) => string,
): string {
  return html.replace(RESOURCE_RE, (_match, rawPath: string) => {
    const path = decodeURIComponent(rawPath);
    try {
      return toAssetUrl(path);
    } catch {
      return "";
    }
  });
}

/**
 * Bridge injected ahead of the extension's own scripts. `initialState` is the
 * webview's last `setState` value: VS Code hands that back after a reload, and
 * extension UIs restore their view from it (a chat's messages, for instance).
 */
export function vscodeApiShim(
  nonce: string | null,
  initialState?: unknown,
): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const seed =
    initialState === undefined ? "{}" : JSON.stringify(initialState ?? null);
  return `<script${nonceAttr}>
(function () {
  var state = ${seed};
  var api = {
    postMessage: function (message) {
      parent.postMessage({ __dcodeWebview: true, message: message }, "*");
    },
    getState: function () { return state; },
    setState: function (next) {
      state = next;
      parent.postMessage({ __dcodeWebviewState: true, state: next }, "*");
      return next;
    }
  };
  window.acquireVsCodeApi = function () { return api; };
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (data && data.__dcodeTheme) {
      var style = document.getElementById(data.styleId);
      if (!style) {
        style = document.createElement("style");
        style.id = data.styleId;
        document.head.appendChild(style);
      }
      style.textContent = data.css;
      if (document.body) {
        document.body.classList.remove("vscode-dark", "vscode-light");
        document.body.classList.add(data.bodyClass);
      }
      return;
    }
    if (data && data.__dcodeHost) {
      window.dispatchEvent(new MessageEvent("message", { data: data.message }));
    }
  });
  function report(text) {
    parent.postMessage({ __dcodeWebviewError: String(text) }, "*");
  }
  // Capture phase: a script or stylesheet that fails to load fires an error
  // event on the element which never reaches a bubbling window listener, and
  // a webview whose bundle 404s just renders nothing.
  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window) {
      var url = target.src || target.href;
      if (url) {
        report("could not load " + url);
        return;
      }
    }
    report((event.message || "script error") + " @ " + (event.filename || "?") + ":" + (event.lineno || 0));
  }, true);
  window.addEventListener("securitypolicyviolation", function (event) {
    report(
      "blocked by the page CSP: " + (event.blockedURI || "?") +
        " (" + (event.violatedDirective || "?") + ")",
    );
  });
  window.addEventListener("unhandledrejection", function (event) {
    report("unhandled rejection: " + (event.reason && event.reason.message ? event.reason.message : event.reason));
  });
})();
</script>`;
}

export function buildWebviewDocument(
  html: string,
  toAssetUrl: (path: string) => string,
  theme?: WebviewThemeInput,
  initialState?: unknown,
): string {
  const origin = assetOriginFrom(toAssetUrl);
  const nonce = extractNonce(html);
  // CSP first: afterwards no bare `dcode-resource:` is left to confuse the
  // resource rewrite.
  const withCsp = rewriteCsp(html, origin);
  const rewritten = rewriteResourceUris(withCsp, toAssetUrl);
  // Theme before the shim so the extension's own styles still win over ours.
  const head =
    codiconLinkTag(origin) +
    (theme ? themeStyleTag(theme) : "") +
    vscodeApiShim(nonce, initialState);

  const withBody = theme
    ? rewritten.replace(/<body\b([^>]*)>/i, (match, attrs: string) =>
        /class\s*=/.test(attrs)
          ? match.replace(
              /class\s*=\s*(["'])([\s\S]*?)\1/i,
              (_m, quote: string, value: string) =>
                `class=${quote}${value} ${themeBodyClass(theme.kind)}${quote}`,
            )
          : `<body${attrs} class="${themeBodyClass(theme.kind)}">`,
      )
    : rewritten;

  // The shim must run before any extension script that calls it.
  const headOpen = /<head[^>]*>/i.exec(withBody);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return withBody.slice(0, at) + head + withBody.slice(at);
  }
  return head + withBody;
}

/** Live theme swap for a mounted webview, applied without reloading it. */
export function themeUpdateMessage(theme: WebviewThemeInput) {
  return {
    __dcodeTheme: true,
    css: webviewThemeCss(theme),
    bodyClass: themeBodyClass(theme.kind),
    styleId: THEME_STYLE_ID,
  };
}

/**
 * Maps an extension file path to a URL on the webview scheme. `convertFileSrc`
 * handles the platform difference (`http://dcode-webview.localhost` on Windows,
 * `dcode-webview://localhost` elsewhere).
 */
export function webviewFileUrl(path: string): string {
  return convertFileSrc(path, WEBVIEW_SCHEME);
}

/**
 * VS Code ships its icon font to every webview, and extension UIs draw their
 * buttons with `codicon-*` classes; without it every icon is an empty box.
 */
export function codiconLinkTag(assetOrigin: string): string {
  if (!assetOrigin) return "";
  return `<link rel="stylesheet" href="${assetOrigin}/__asset__/codicon.css">`;
}

/** Prefix the extension host appends an encoded path to. */
export function webviewUrlPrefix(): string {
  const sample = webviewFileUrl("dcode-probe");
  return sample.slice(0, sample.length - "dcode-probe".length);
}

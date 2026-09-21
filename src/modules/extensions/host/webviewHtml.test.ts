import { describe, expect, it } from "vitest";
import {
  codiconLinkTag,
  relaxCsp,
  assetOriginFrom,
  buildWebviewDocument,
  extractNonce,
  rewriteCsp,
  rewriteResourceUris,
} from "./webviewHtml";

const toAssetUrl = (path: string) =>
  `asset://localhost/${path.replace(/^\//, "")}`;

describe("rewriteResourceUris", () => {
  it("maps a resource uri in an attribute", () => {
    expect(
      rewriteResourceUris(
        '<script src="dcode-resource:/ext/webview/index.js">',
        toAssetUrl,
      ),
    ).toBe('<script src="asset://localhost/ext/webview/index.js">');
  });

  it("maps every occurrence", () => {
    const html = `<link href="dcode-resource:/a.css"><script src="dcode-resource:/b.js">`;
    const out = rewriteResourceUris(html, toAssetUrl);
    expect(out).not.toContain("dcode-resource:");
    expect(out).toContain("asset://localhost/a.css");
    expect(out).toContain("asset://localhost/b.js");
  });

  it("decodes percent-encoded paths", () => {
    expect(
      rewriteResourceUris('"dcode-resource:/a%20b/c.js"', toAssetUrl),
    ).toBe('"asset://localhost/a b/c.js"');
  });

  it("leaves html without resources untouched", () => {
    expect(rewriteResourceUris("<p>hi</p>", toAssetUrl)).toBe("<p>hi</p>");
  });

  it("drops a uri the mapper rejects instead of breaking the document", () => {
    const out = rewriteResourceUris('src="dcode-resource:/nope.js"', () => {
      throw new Error("outside the extension");
    });
    expect(out).toBe('src=""');
  });
});

describe("assetOriginFrom", () => {
  it("reads the origin the platform mapper produces", () => {
    expect(assetOriginFrom((p) => `http://asset.localhost/${p}`)).toBe(
      "http://asset.localhost",
    );
    expect(assetOriginFrom((p) => `asset://localhost/${p}`)).toBe(
      "asset://localhost",
    );
  });
});

describe("rewriteCsp", () => {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src dcode-resource: 'unsafe-inline'; img-src dcode-resource: data:; script-src 'nonce-abc123';">`;

  it("points the webview scheme at the real asset origin", () => {
    const out = rewriteCsp(csp, "http://asset.localhost");
    expect(out).toContain("style-src http://asset.localhost 'unsafe-inline'");
    expect(out).toContain("img-src http://asset.localhost data:");
    expect(out).not.toContain("dcode-resource:");
  });

  it("keeps the nonce untouched", () => {
    expect(rewriteCsp(csp, "http://asset.localhost")).toContain(
      "'nonce-abc123'",
    );
  });

  it("leaves html without a csp alone", () => {
    expect(rewriteCsp("<head></head>", "http://asset.localhost")).toBe(
      "<head></head>",
    );
  });
});

describe("extractNonce", () => {
  it("finds the script nonce in the csp", () => {
    expect(
      extractNonce(
        `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-abc123';">`,
      ),
    ).toBe("abc123");
  });

  it("returns null when there is none", () => {
    expect(extractNonce("<head></head>")).toBeNull();
  });
});

describe("buildWebviewDocument", () => {
  it("injects the api shim right after <head>", () => {
    const out = buildWebviewDocument(
      "<html><head><title>x</title></head></html>",
      toAssetUrl,
    );
    const shimAt = out.indexOf("acquireVsCodeApi");
    const titleAt = out.indexOf("<title>");
    expect(shimAt).toBeGreaterThan(-1);
    expect(shimAt).toBeLessThan(titleAt);
  });

  it("prepends the shim when there is no head", () => {
    const out = buildWebviewDocument("<div>x</div>", toAssetUrl);
    expect(out.indexOf("acquireVsCodeApi")).toBeLessThan(out.indexOf("<div>"));
  });

  it("gives the injected shim the page nonce so the csp allows it", () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-abc123';"></head></html>`;
    const out = buildWebviewDocument(html, toAssetUrl);
    expect(out).toContain('<script nonce="abc123">');
  });

  it("does not mangle a bare scheme in the csp into a resource url", () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="font-src dcode-resource:;"></head><link href="dcode-resource:/a.css">`;
    const out = buildWebviewDocument(html, toAssetUrl);
    expect(out).toContain("font-src asset://localhost");
    expect(out).toContain("asset://localhost/a.css");
    expect(out).not.toContain("dcode-resource:");
  });

  it("rewrites resources while injecting", () => {
    const out = buildWebviewDocument(
      '<head></head><script src="dcode-resource:/x.js"></script>',
      toAssetUrl,
    );
    expect(out).toContain("asset://localhost/x.js");
    expect(out).toContain("acquireVsCodeApi");
  });
});

describe("relaxCsp", () => {
  it("adds data: and the app origin where assets load from", () => {
    const out = relaxCsp(
      "default-src 'none'; font-src https://a; img-src https://a; style-src 'unsafe-inline'; script-src 'nonce-x'",
      "asset://localhost",
    );
    expect(out).toContain("font-src https://a data: asset://localhost");
    expect(out).toContain("img-src https://a data: asset://localhost");
    expect(out).toContain("style-src 'unsafe-inline' asset://localhost");
    expect(out).toContain("script-src 'nonce-x'");
  });

  it("does not repeat a source that is already allowed", () => {
    expect(
      relaxCsp(
        "font-src https://a data: asset://localhost",
        "asset://localhost",
      ),
    ).toBe("font-src https://a data: asset://localhost");
  });
});

describe("codiconLinkTag", () => {
  it("points at the font stylesheet the app serves", () => {
    expect(codiconLinkTag("asset://localhost")).toBe(
      '<link rel="stylesheet" href="asset://localhost/__asset__/codicon.css">',
    );
    expect(codiconLinkTag("")).toBe("");
  });
});

describe("buildWebviewDocument with a theme", () => {
  const html =
    '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; font-src dcode-resource:"></head><body class="claude"><p>hi</p></body></html>';

  it("injects the variables and tags the body", () => {
    const out = buildWebviewDocument(html, toAssetUrl, {
      tokens: { foreground: "#eee" },
      kind: "dark",
    });
    expect(out).toContain("--vscode-foreground: #eee");
    expect(out).toContain('class="claude vscode-dark"');
    expect(out).toContain("font-src asset://localhost data:");
  });

  it("adds a class to a body that has none", () => {
    const out = buildWebviewDocument(
      "<html><body><p>hi</p></body></html>",
      toAssetUrl,
      {
        tokens: {},
        kind: "light",
      },
    );
    expect(out).toContain('<body class="vscode-light">');
  });

  it("leaves the document alone when no theme is given", () => {
    const out = buildWebviewDocument(html, toAssetUrl);
    expect(out).not.toContain("--vscode-foreground");
    expect(out).toContain('class="claude"');
  });
});

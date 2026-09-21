import { describe, expect, it } from "vitest";
import {
  buildIconIndex,
  extensionChain,
  lookupFileIcon,
  lookupFolderIcon,
  type IconThemeDoc,
} from "./iconTheme";

const DOC: IconThemeDoc = {
  iconDefinitions: {
    _file: { iconPath: "./icons/file.svg" },
    _folder: { iconPath: "./icons/folder.svg" },
    _folder_open: { iconPath: "./icons/folder-open.svg" },
    _ts: { iconPath: "./icons/typescript.svg" },
    _test_ts: { iconPath: "./icons/test-ts.svg" },
    _npm: { iconPath: "./icons/npm.svg" },
    _src: { iconPath: "./icons/folder-src.svg" },
    _src_open: { iconPath: "./icons/folder-src-open.svg" },
    _root: { iconPath: "./icons/folder-root.svg" },
    _root_open: { iconPath: "./icons/folder-root-open.svg" },
    _root_named: { iconPath: "./icons/folder-root-named.svg" },
    _glyph: { fontCharacter: "\\e001" },
    _rust_lang: { iconPath: "./icons/rust.svg" },
  },
  file: "_file",
  folder: "_folder",
  folderExpanded: "_folder_open",
  fileExtensions: { ts: "_ts", "test.ts": "_test_ts", md: "_glyph" },
  fileNames: { "package.json": "_npm" },
  folderNames: { SRC: "_src" },
  folderNamesExpanded: { SRC: "_src_open" },
  rootFolder: "_root",
  rootFolderExpanded: "_root_open",
  rootFolderNames: { myrepo: "_root_named" },
  languageIds: { rust: "_rust_lang" },
};

const index = buildIconIndex(DOC, "dark");

describe("extensionChain", () => {
  it("returns every suffix, longest first", () => {
    expect(extensionChain("api.test.ts")).toEqual(["test.ts", "ts"]);
    expect(extensionChain("main.rs")).toEqual(["rs"]);
    expect(extensionChain("Makefile")).toEqual([]);
    expect(extensionChain("trailing.")).toEqual([]);
  });
});

describe("buildIconIndex", () => {
  it("drops font-glyph definitions so the built-in icon can take over", () => {
    expect(index.paths._glyph).toBeUndefined();
    expect(lookupFileIcon(index, "readme.md")).toBe("./icons/file.svg");
  });

  it("lowercases lookup keys", () => {
    expect(index.folderNames.src).toBe("_src");
  });

  it("overlays only the maps the light variant declares", () => {
    const light = buildIconIndex(
      { ...DOC, light: { fileNames: { "package.json": "_ts" } } },
      "light",
    );
    expect(lookupFileIcon(light, "package.json")).toBe(
      "./icons/typescript.svg",
    );
    expect(lookupFileIcon(light, "main.ts")).toBe("./icons/typescript.svg");
    expect(light.defaultFile).toBe("_file");
  });
});

describe("lookupFileIcon", () => {
  it("prefers an exact file name", () => {
    expect(lookupFileIcon(index, "package.json")).toBe("./icons/npm.svg");
    expect(lookupFileIcon(index, "PACKAGE.JSON")).toBe("./icons/npm.svg");
  });

  it("prefers the longest matching extension", () => {
    expect(lookupFileIcon(index, "api.test.ts")).toBe("./icons/test-ts.svg");
    expect(lookupFileIcon(index, "api.ts")).toBe("./icons/typescript.svg");
  });

  it("falls back to the language id, then the default file icon", () => {
    expect(lookupFileIcon(index, "main.rs", "rust")).toBe("./icons/rust.svg");
    expect(lookupFileIcon(index, "unknown.xyz")).toBe("./icons/file.svg");
  });
});

describe("lookupFolderIcon", () => {
  it("uses the expanded variant when open", () => {
    expect(lookupFolderIcon(index, "src", true)).toBe(
      "./icons/folder-src-open.svg",
    );
    expect(lookupFolderIcon(index, "src", false)).toBe(
      "./icons/folder-src.svg",
    );
  });

  it("falls back to the default folder icons", () => {
    expect(lookupFolderIcon(index, "whatever", false)).toBe(
      "./icons/folder.svg",
    );
    expect(lookupFolderIcon(index, "whatever", true)).toBe(
      "./icons/folder-open.svg",
    );
  });

  it("returns null when the theme defines no folder icons", () => {
    const bare = buildIconIndex({ iconDefinitions: {}, file: "_file" }, "dark");
    expect(lookupFolderIcon(bare, "src", false)).toBeNull();
  });
});

describe("lookupFolderIcon for the workspace root", () => {
  it("uses the root icons, open and closed", () => {
    expect(lookupFolderIcon(index, "anything", false, true)).toBe(
      "./icons/folder-root.svg",
    );
    expect(lookupFolderIcon(index, "anything", true, true)).toBe(
      "./icons/folder-root-open.svg",
    );
  });

  it("prefers a named root icon", () => {
    expect(lookupFolderIcon(index, "MyRepo", false, true)).toBe(
      "./icons/folder-root-named.svg",
    );
  });

  it("falls back to the plain folder icons when the theme has no root variant", () => {
    const noRoot = buildIconIndex(
      {
        ...DOC,
        rootFolder: undefined,
        rootFolderExpanded: undefined,
        rootFolderNames: {},
      },
      "dark",
    );
    expect(lookupFolderIcon(noRoot, "src", false, true)).toBe(
      "./icons/folder-src.svg",
    );
    expect(lookupFolderIcon(noRoot, "other", false, true)).toBe(
      "./icons/folder.svg",
    );
  });

  it("leaves non-root folders on the normal path", () => {
    expect(lookupFolderIcon(index, "src", false)).toBe(
      "./icons/folder-src.svg",
    );
  });
});

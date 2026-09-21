/**
 * VS Code icon themes are pure data: a JSON file mapping file names, extensions
 * and language ids to icon definitions, most of which point at an SVG shipped
 * inside the extension. That needs no extension host, only a lookup table.
 */
export type IconDefinition = {
  iconPath?: string;
  fontCharacter?: string;
};

export type IconThemeDoc = {
  iconDefinitions?: Record<string, IconDefinition>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  rootFolder?: string;
  rootFolderExpanded?: string;
  rootFolderNames?: Record<string, string>;
  rootFolderNamesExpanded?: Record<string, string>;
  languageIds?: Record<string, string>;
  light?: Omit<IconThemeDoc, "light">;
};

export type IconThemeIndex = {
  /** Definition key -> icon path relative to the icon theme JSON. */
  paths: Record<string, string>;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  languageIds: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  rootFolderNames: Record<string, string>;
  rootFolderNamesExpanded: Record<string, string>;
  defaultFile: string | null;
  defaultFolder: string | null;
  defaultFolderExpanded: string | null;
  defaultRootFolder: string | null;
  defaultRootFolderExpanded: string | null;
};

function lowerKeys(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * `light` overrides only the maps it declares, so merge it over the base rather
 * than replacing it.
 */
export function buildIconIndex(
  doc: IconThemeDoc,
  mode: "light" | "dark",
): IconThemeIndex {
  const overlay = mode === "light" ? (doc.light ?? {}) : {};
  const paths: Record<string, string> = {};
  for (const [key, def] of Object.entries(doc.iconDefinitions ?? {})) {
    // Font-glyph definitions need the theme's icon font; skip them so the
    // built-in icon shows instead of an empty square.
    if (def && typeof def.iconPath === "string" && def.iconPath.length > 0) {
      paths[key] = def.iconPath;
    }
  }
  return {
    paths,
    fileNames: { ...lowerKeys(doc.fileNames), ...lowerKeys(overlay.fileNames) },
    fileExtensions: {
      ...lowerKeys(doc.fileExtensions),
      ...lowerKeys(overlay.fileExtensions),
    },
    languageIds: {
      ...lowerKeys(doc.languageIds),
      ...lowerKeys(overlay.languageIds),
    },
    folderNames: {
      ...lowerKeys(doc.folderNames),
      ...lowerKeys(overlay.folderNames),
    },
    folderNamesExpanded: {
      ...lowerKeys(doc.folderNamesExpanded),
      ...lowerKeys(overlay.folderNamesExpanded),
    },
    rootFolderNames: {
      ...lowerKeys(doc.rootFolderNames),
      ...lowerKeys(overlay.rootFolderNames),
    },
    rootFolderNamesExpanded: {
      ...lowerKeys(doc.rootFolderNamesExpanded),
      ...lowerKeys(overlay.rootFolderNamesExpanded),
    },
    defaultFile: overlay.file ?? doc.file ?? null,
    defaultFolder: overlay.folder ?? doc.folder ?? null,
    defaultFolderExpanded: overlay.folderExpanded ?? doc.folderExpanded ?? null,
    defaultRootFolder: overlay.rootFolder ?? doc.rootFolder ?? null,
    defaultRootFolderExpanded:
      overlay.rootFolderExpanded ?? doc.rootFolderExpanded ?? null,
  };
}

function definitionPath(
  index: IconThemeIndex,
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  return index.paths[key] ?? null;
}

/** Every progressively shorter extension of `name`, longest first. */
export function extensionChain(name: string): string[] {
  const lower = name.toLowerCase();
  const out: string[] = [];
  let from = lower.indexOf(".");
  while (from !== -1 && from < lower.length - 1) {
    out.push(lower.slice(from + 1));
    from = lower.indexOf(".", from + 1);
  }
  return out;
}

export function lookupFileIcon(
  index: IconThemeIndex,
  name: string,
  languageId?: string | null,
): string | null {
  const lower = name.toLowerCase();
  const byName = definitionPath(index, index.fileNames[lower]);
  if (byName) return byName;
  for (const ext of extensionChain(lower)) {
    const byExt = definitionPath(index, index.fileExtensions[ext]);
    if (byExt) return byExt;
  }
  if (languageId) {
    const byLang = definitionPath(
      index,
      index.languageIds[languageId.toLowerCase()],
    );
    if (byLang) return byLang;
  }
  return definitionPath(index, index.defaultFile);
}

export function lookupFolderIcon(
  index: IconThemeIndex,
  name: string,
  expanded: boolean,
  isRoot = false,
): string | null {
  const lower = name.toLowerCase();
  // VS Code gives the workspace root its own icon, falling back to the plain
  // folder icons when the theme defines no root variant.
  if (isRoot) {
    if (expanded) {
      const rootExpanded = definitionPath(
        index,
        index.rootFolderNamesExpanded[lower],
      );
      if (rootExpanded) return rootExpanded;
    }
    const rootNamed = definitionPath(index, index.rootFolderNames[lower]);
    if (rootNamed) return rootNamed;
    const rootDefault = definitionPath(
      index,
      expanded
        ? (index.defaultRootFolderExpanded ?? index.defaultRootFolder)
        : index.defaultRootFolder,
    );
    if (rootDefault) return rootDefault;
  }
  if (expanded) {
    const specific = definitionPath(index, index.folderNamesExpanded[lower]);
    if (specific) return specific;
  }
  const named = definitionPath(index, index.folderNames[lower]);
  if (named) return named;
  return definitionPath(
    index,
    expanded
      ? (index.defaultFolderExpanded ?? index.defaultFolder)
      : index.defaultFolder,
  );
}

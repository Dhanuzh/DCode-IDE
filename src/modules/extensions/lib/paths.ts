/**
 * Resolves a `include` path that is relative to the file it appears in.
 * Both sides come from an extension manifest, so they stay relative and
 * `..` may not climb above the extension root.
 */
export function resolveRelative(from: string, target: string): string | null {
  const clean = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const fromParts = clean(from).split("/");
  fromParts.pop();
  const out: string[] = [...fromParts];
  for (const part of clean(target).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.length > 0 ? out.join("/") : null;
}

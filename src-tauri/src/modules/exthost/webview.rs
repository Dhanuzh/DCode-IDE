use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Documents and assets for extension webviews, served over their own URI
/// scheme. A sandboxed `srcdoc` frame has an opaque origin, where
/// `localStorage` throws and module scripts fail CORS, so webviews get a real
/// origin of their own instead.
#[derive(Default)]
pub struct WebviewDocs {
    docs: Mutex<HashMap<String, String>>,
    /// Directory of the running extension; nothing outside it is served.
    root: Mutex<Option<PathBuf>>,
}

pub const VIEW_PREFIX: &str = "__view__";
/// Files the app itself serves into webviews, alongside the extension's own.
pub const ASSET_PREFIX: &str = "__asset__";

// VS Code injects its icon font into every webview and extension UIs render
// their buttons with `codicon-*` classes, so without it every icon is a blank
// box. Embedded rather than written to disk: it is read on every view load.
const CODICON_CSS: &str = include_str!("../../../resources/exthost/codicons/codicon.css");
const CODICON_TTF: &[u8] = include_bytes!("../../../resources/exthost/codicons/codicon.ttf");

/// One of the app's own webview assets, by request path.
pub fn builtin_asset(name: &str) -> Option<(&'static str, &'static [u8])> {
    match name.split('?').next().unwrap_or(name) {
        "codicon.css" => Some(("text/css; charset=utf-8", CODICON_CSS.as_bytes())),
        "codicon.ttf" => Some(("font/ttf", CODICON_TTF)),
        _ => None,
    }
}

impl WebviewDocs {
    pub fn set_root(&self, root: Option<PathBuf>) {
        if let Ok(mut guard) = self.root.lock() {
            *guard = root;
        }
        if root_cleared(self) {
            if let Ok(mut docs) = self.docs.lock() {
                docs.clear();
            }
        }
    }

    pub fn set_html(&self, view_id: String, html: String) {
        if let Ok(mut docs) = self.docs.lock() {
            docs.insert(view_id, html);
        }
    }

    pub fn html(&self, view_id: &str) -> Option<String> {
        self.docs.lock().ok()?.get(view_id).cloned()
    }

    /// Resolves a request path to a file inside the running extension, or
    /// `None` when it escapes that directory.
    pub fn resolve_file(&self, request_path: &str) -> Option<PathBuf> {
        let root = self.root.lock().ok()?.clone()?;
        let candidate = decoded_path(request_path)?;
        let canonical_root = root.canonicalize().ok()?;
        let canonical = candidate.canonicalize().ok()?;
        canonical.starts_with(&canonical_root).then_some(canonical)
    }
}

fn root_cleared(state: &WebviewDocs) -> bool {
    state.root.lock().map(|r| r.is_none()).unwrap_or(false)
}

/// `convertFileSrc` builds `<scheme>://localhost/<encoded path>`, so the path
/// always arrives with a leading slash. On Windows that turns `C:/ext/app.js`
/// into `/C:/ext/app.js`, where the drive letter parses as a directory under
/// the root and every webview asset 404s (a blank panel with no error).
pub fn strip_leading_drive_slash(path: &str) -> &str {
    let bytes = path.as_bytes();
    let is_drive =
        bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':';
    if is_drive {
        &path[1..]
    } else {
        path
    }
}

/// Request paths arrive percent-encoded and absolute; reject traversal.
pub fn decoded_path(request_path: &str) -> Option<PathBuf> {
    let decoded = strip_leading_drive_slash(&percent_decode(request_path)).to_string();
    if decoded.is_empty() || decoded.contains('\0') {
        return None;
    }
    let path = PathBuf::from(&decoded);
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    Some(path)
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("js") | Some("mjs") | Some("cjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("/c%3A/x"), "/c:/x");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn drops_the_slash_in_front_of_a_windows_drive() {
        assert_eq!(strip_leading_drive_slash("/C:/ext/app.js"), "C:/ext/app.js");
        assert_eq!(
            strip_leading_drive_slash("/c:\\ext\\app.js"),
            "c:\\ext\\app.js"
        );
        assert_eq!(
            strip_leading_drive_slash("/home/u/app.js"),
            "/home/u/app.js"
        );
        assert_eq!(strip_leading_drive_slash("/__view__/a"), "/__view__/a");
        assert_eq!(strip_leading_drive_slash("/"), "/");
    }

    #[test]
    fn a_windows_asset_request_keeps_its_drive() {
        let path = decoded_path("/C%3A/ext/app.js").expect("path");
        assert_eq!(path.to_string_lossy(), "C:/ext/app.js");
    }

    #[test]
    fn rejects_traversal_and_empty_paths() {
        assert!(decoded_path("").is_none());
        assert!(decoded_path("/ext/../../etc/passwd").is_none());
        assert!(decoded_path("/ext/%2e%2e/secret").is_none());
        assert!(decoded_path("/ext/webview/index.js").is_some());
    }

    #[test]
    fn serves_only_inside_the_extension_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("ext");
        std::fs::create_dir_all(root.join("webview")).expect("mkdir");
        std::fs::write(root.join("webview/index.js"), "x").expect("write");
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "secret").expect("write");

        let state = WebviewDocs::default();
        state.set_root(Some(root.clone()));

        let inside = root.join("webview/index.js");
        assert!(state.resolve_file(&inside.to_string_lossy()).is_some());
        assert!(state.resolve_file(&outside.to_string_lossy()).is_none());
    }

    #[test]
    fn serves_nothing_without_a_running_extension() {
        let state = WebviewDocs::default();
        assert!(state.resolve_file("/anything").is_none());
    }

    #[test]
    fn stores_and_returns_documents() {
        let state = WebviewDocs::default();
        state.set_html("view-a".into(), "<html></html>".into());
        assert_eq!(state.html("view-a").as_deref(), Some("<html></html>"));
        assert!(state.html("view-b").is_none());
    }

    #[test]
    fn serves_the_codicon_font_and_stylesheet() {
        let (css_type, css) = builtin_asset("codicon.css").expect("css");
        assert_eq!(css_type, "text/css; charset=utf-8");
        assert!(std::str::from_utf8(css).unwrap().contains("codicon-add"));
        // The stylesheet asks for the font next to itself.
        let (font_type, font) = builtin_asset("codicon.ttf?9aab").expect("font");
        assert_eq!(font_type, "font/ttf");
        assert!(font.len() > 1000);
        assert!(builtin_asset("anything-else").is_none());
    }

    #[test]
    fn maps_content_types() {
        assert_eq!(
            content_type_for(Path::new("a/index.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for(Path::new("a/style.CSS")),
            "text/css; charset=utf-8"
        );
        assert_eq!(content_type_for(Path::new("a/font.woff2")), "font/woff2");
        assert_eq!(
            content_type_for(Path::new("a/blob")),
            "application/octet-stream"
        );
    }
}

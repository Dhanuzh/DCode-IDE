use serde::Serialize;

const API_ROOT: &str = "https://open-vsx.org/api";
const MAX_QUERY_LEN: usize = 100;
const MAX_RESULTS: u32 = 50;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtSummary {
    pub namespace: String,
    pub name: String,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub download_count: u64,
    pub average_rating: Option<f64>,
    pub icon_url: Option<String>,
}

/// Registry ids land in URLs and on disk, so they stay to the conservative set
/// Open VSX itself allows.
pub fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !value.starts_with('.')
        && !value.contains("..")
}

pub fn is_valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
        && !value.contains("..")
}

pub fn normalize_query(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("search query is empty".into());
    }
    if trimmed.len() > MAX_QUERY_LEN {
        return Err("search query is too long".into());
    }
    Ok(trimmed.to_string())
}

pub fn clamp_size(size: u32) -> u32 {
    size.clamp(1, MAX_RESULTS)
}

/// Open VSX categories are a fixed vocabulary; only pass through one we know.
pub fn normalize_category(raw: Option<&str>) -> Option<&'static str> {
    match raw?.trim() {
        "Themes" => Some("Themes"),
        "Programming Languages" => Some("Programming Languages"),
        "Snippets" => Some("Snippets"),
        _ => None,
    }
}

pub fn search_url(query: &str, size: u32, category: Option<&str>) -> String {
    let encoded: String = query
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect();
    let category = match normalize_category(category) {
        Some(name) => format!("&category={}", name.replace(' ', "+")),
        None => String::new(),
    };
    format!(
        "{API_ROOT}/-/search?query={encoded}&size={}&offset=0&includeAllVersions=false{category}",
        clamp_size(size)
    )
}

pub fn metadata_url(namespace: &str, name: &str, version: Option<&str>) -> String {
    match version {
        Some(v) => format!("{API_ROOT}/{namespace}/{name}/{v}"),
        None => format!("{API_ROOT}/{namespace}/{name}/latest"),
    }
}

/// Extensions that ship native binaries publish one package per platform, and
/// the unqualified `latest` can resolve to any of them (alpine-arm64 for a
/// Windows user, say). Ask for this machine's build first.
pub fn target_metadata_url(
    namespace: &str,
    name: &str,
    target: &str,
    version: Option<&str>,
) -> String {
    match version {
        Some(v) => format!("{API_ROOT}/{namespace}/{name}/{target}/{v}"),
        None => format!("{API_ROOT}/{namespace}/{name}/{target}/latest"),
    }
}

/// VS Code's `targetPlatform` id for the host, as Open VSX publishes them.
pub const fn host_target_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        #[cfg(target_arch = "aarch64")]
        {
            "win32-arm64"
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            "win32-x64"
        }
    }
    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        {
            "darwin-arm64"
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            "darwin-x64"
        }
    }
    #[cfg(all(target_os = "linux", target_env = "musl"))]
    {
        #[cfg(target_arch = "aarch64")]
        {
            "alpine-arm64"
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            "alpine-x64"
        }
    }
    #[cfg(all(target_os = "linux", not(target_env = "musl")))]
    {
        #[cfg(target_arch = "aarch64")]
        {
            "linux-arm64"
        }
        #[cfg(target_arch = "arm")]
        {
            "linux-armhf"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "arm")))]
        {
            "linux-x64"
        }
    }
}

/// Download URLs come back from the registry; only take ones it actually serves.
pub fn is_trusted_download(url: &str) -> bool {
    url.starts_with("https://open-vsx.org/")
}

pub fn parse_search(raw: &str) -> Result<Vec<ExtSummary>, String> {
    let json: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("registry sent invalid JSON: {e}"))?;
    let Some(list) = json.get("extensions").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::with_capacity(list.len());
    for item in list {
        let namespace = item.get("namespace").and_then(|v| v.as_str());
        let name = item.get("name").and_then(|v| v.as_str());
        let (Some(namespace), Some(name)) = (namespace, name) else {
            continue;
        };
        if !is_valid_id(namespace) || !is_valid_id(name) {
            continue;
        }
        let version = item
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("latest");
        if !is_valid_version(version) {
            continue;
        }
        let icon_url = item
            .get("files")
            .and_then(|f| f.get("icon"))
            .and_then(|v| v.as_str())
            .filter(|u| is_trusted_download(u))
            .map(|s| s.to_string());
        out.push(ExtSummary {
            namespace: namespace.to_string(),
            name: name.to_string(),
            version: version.to_string(),
            display_name: item
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or(name)
                .to_string(),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            download_count: item
                .get("downloadCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            average_rating: item.get("averageRating").and_then(|v| v.as_f64()),
            icon_url,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Release {
    pub version: String,
    pub download_url: String,
    /// Registry-published checksum for the package, when it offers one.
    pub sha256_url: Option<String>,
    /// The package's `package.json`, readable without downloading the package.
    pub manifest_url: Option<String>,
}

pub fn parse_release(raw: &str) -> Result<Release, String> {
    let json: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("registry sent invalid JSON: {e}"))?;
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("registry response has no version")?;
    if !is_valid_version(version) {
        return Err("registry returned an unusable version".into());
    }
    let files = json.get("files");
    let download_url = files
        .and_then(|f| f.get("download"))
        .and_then(|v| v.as_str())
        .ok_or("this extension has no downloadable package")?;
    if !is_trusted_download(download_url) {
        return Err("registry returned an untrusted download URL".into());
    }
    let sha256_url = files
        .and_then(|f| f.get("sha256"))
        .and_then(|v| v.as_str())
        .filter(|u| is_trusted_download(u))
        .map(|s| s.to_string());
    let manifest_url = files
        .and_then(|f| f.get("manifest"))
        .and_then(|v| v.as_str())
        .filter(|u| is_trusted_download(u))
        .map(|s| s.to_string());
    Ok(Release {
        version: version.to_string(),
        download_url: download_url.to_string(),
        sha256_url,
        manifest_url,
    })
}

/// The registry serves a bare lowercase hex digest, sometimes with a trailing
/// file name in `sha256sum` style.
pub fn parse_expected_digest(raw: &str) -> Option<String> {
    let token = raw.split_whitespace().next()?;
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(token.to_ascii_lowercase())
}

pub fn hex_digest(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_registry_ids() {
        assert!(is_valid_id("dracula-theme"));
        assert!(is_valid_id("ms-python.python"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("../etc"));
        assert!(!is_valid_id(".hidden"));
        assert!(!is_valid_id("has/slash"));
        assert!(!is_valid_id("has space"));
        assert!(!is_valid_id(&"x".repeat(65)));
    }

    #[test]
    fn validates_versions() {
        assert!(is_valid_version("2.24.3"));
        assert!(is_valid_version("1.0.0-beta.1"));
        assert!(!is_valid_version("../1.0.0"));
        assert!(!is_valid_version(""));
    }

    #[test]
    fn normalizes_and_rejects_queries() {
        assert_eq!(normalize_query("  dracula "), Ok("dracula".into()));
        assert!(normalize_query("   ").is_err());
        assert!(normalize_query(&"x".repeat(101)).is_err());
    }

    #[test]
    fn builds_a_percent_encoded_search_url() {
        assert_eq!(
            search_url("one dark", 20, None),
            "https://open-vsx.org/api/-/search?query=one+dark&size=20&offset=0&includeAllVersions=false"
        );
        assert!(search_url("a&b=c", 20, None).contains("query=a%26b%3Dc"));
    }

    #[test]
    fn appends_only_a_known_category() {
        assert!(search_url("x", 20, Some("Themes")).ends_with("&category=Themes"));
        assert!(search_url("x", 20, Some("Programming Languages"))
            .ends_with("&category=Programming+Languages"));
        assert!(!search_url("x", 20, Some("../evil")).contains("category"));
        assert!(!search_url("x", 20, None).contains("category"));
    }

    #[test]
    fn clamps_the_result_size() {
        assert_eq!(clamp_size(0), 1);
        assert_eq!(clamp_size(999), 50);
        assert_eq!(clamp_size(20), 20);
    }

    #[test]
    fn builds_a_target_specific_metadata_url() {
        assert_eq!(
            target_metadata_url("Anthropic", "claude-code", "win32-x64", None),
            "https://open-vsx.org/api/Anthropic/claude-code/win32-x64/latest"
        );
        assert_eq!(
            target_metadata_url("a", "b", "linux-x64", Some("1.0.0")),
            "https://open-vsx.org/api/a/b/linux-x64/1.0.0"
        );
    }

    #[test]
    fn names_a_platform_open_vsx_publishes() {
        assert!([
            "win32-x64",
            "win32-arm64",
            "darwin-x64",
            "darwin-arm64",
            "linux-x64",
            "linux-arm64",
            "linux-armhf",
            "alpine-x64",
            "alpine-arm64",
        ]
        .contains(&host_target_platform()));
    }

    #[test]
    fn builds_metadata_urls() {
        assert_eq!(
            metadata_url("dracula-theme", "theme-dracula", None),
            "https://open-vsx.org/api/dracula-theme/theme-dracula/latest"
        );
        assert_eq!(
            metadata_url("a", "b", Some("1.2.3")),
            "https://open-vsx.org/api/a/b/1.2.3"
        );
    }

    #[test]
    fn only_trusts_registry_download_urls() {
        assert!(is_trusted_download(
            "https://open-vsx.org/api/a/b/1/file/a.b-1.vsix"
        ));
        assert!(!is_trusted_download("https://evil.example/a.vsix"));
        assert!(!is_trusted_download("http://open-vsx.org/a.vsix"));
    }

    #[test]
    fn parses_search_results_and_drops_bad_rows() {
        let raw = r#"{
            "extensions": [
                {
                    "namespace": "dracula-theme",
                    "name": "theme-dracula",
                    "version": "2.24.3",
                    "displayName": "Dracula Official",
                    "description": "Dark theme",
                    "downloadCount": 1234,
                    "averageRating": 4.8,
                    "files": { "icon": "https://open-vsx.org/api/dracula-theme/theme-dracula/2.24.3/file/icon.png" }
                },
                { "namespace": "../evil", "name": "x", "version": "1.0.0" },
                { "name": "no-namespace" }
            ]
        }"#;
        let out = parse_search(raw).expect("parses");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].display_name, "Dracula Official");
        assert_eq!(out[0].download_count, 1234);
        assert!(out[0].icon_url.is_some());
    }

    #[test]
    fn drops_icons_served_from_other_hosts() {
        let raw = r#"{"extensions":[{"namespace":"a","name":"b","version":"1.0.0",
            "files":{"icon":"https://cdn.example/icon.png"}}]}"#;
        let out = parse_search(raw).expect("parses");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].icon_url, None);
    }

    #[test]
    fn parses_a_release_with_its_checksum() {
        let raw = r#"{"version":"1.2.3","files":{
            "download":"https://open-vsx.org/api/a/b/1.2.3/file/a.b-1.2.3.vsix",
            "sha256":"https://open-vsx.org/api/a/b/1.2.3/file/a.b-1.2.3.sha256"}}"#;
        let release = parse_release(raw).expect("parses");
        assert_eq!(release.version, "1.2.3");
        assert!(release.download_url.ends_with(".vsix"));
        assert!(release.sha256_url.is_some());
    }

    #[test]
    fn tolerates_a_release_without_a_checksum() {
        let raw = r#"{"version":"1.0.0","files":{"download":"https://open-vsx.org/x.vsix"}}"#;
        assert_eq!(parse_release(raw).expect("parses").sha256_url, None);
    }

    #[test]
    fn ignores_a_checksum_served_from_another_host() {
        let raw = r#"{"version":"1.0.0","files":{"download":"https://open-vsx.org/x.vsix",
            "sha256":"https://evil.example/x.sha256"}}"#;
        assert_eq!(parse_release(raw).expect("parses").sha256_url, None);
    }

    #[test]
    fn rejects_a_foreign_download_url() {
        let raw = r#"{"version":"1.0.0","files":{"download":"https://evil.example/x.vsix"}}"#;
        assert!(parse_release(raw).is_err());
    }

    #[test]
    fn reads_a_bare_or_sha256sum_style_digest() {
        let hex = "f4d8c28fc64874b1b959cc90dbd39c84d5d35c9cf203e32b7a758dc9abf5b1cb";
        assert_eq!(parse_expected_digest(hex), Some(hex.to_string()));
        assert_eq!(
            parse_expected_digest(&format!("{}  package.vsix\n", hex.to_uppercase())),
            Some(hex.to_string())
        );
        assert_eq!(parse_expected_digest("not-a-digest"), None);
        assert_eq!(parse_expected_digest(""), None);
    }

    #[test]
    fn formats_a_digest_as_lowercase_hex() {
        assert_eq!(hex_digest(&[0x00, 0x0f, 0xa9, 0xff]), "000fa9ff");
    }
}

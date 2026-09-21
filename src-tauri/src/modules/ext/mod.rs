mod archive;
mod manifest;
mod registry;

use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;

pub use manifest::{IconThemeContribution, ManifestInfo, ThemeContribution};
pub use registry::ExtSummary;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
// `Client::timeout` covers the whole request *including the body*, which kills
// any download slower than it - a 90 MB package on a normal connection. A
// download instead gets a connect timeout plus an idle (per-read) timeout, so
// slow-but-progressing transfers finish and stalled ones still fail.
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
// Extensions that bundle a native binary are big (Claude Code ships ~97 MB).
// The package is streamed to disk, so this bounds disk use, not memory.
const MAX_VSIX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
const USER_AGENT: &str = concat!("DCode-IDE/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExt {
    /// `<namespace>.<name>`, matching the on-disk directory.
    pub id: String,
    pub dir: String,
    pub icon_path: Option<String>,
    #[serde(flatten)]
    pub manifest: ManifestInfo,
}

fn extensions_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("could not resolve the user data directory")?;
    Ok(base.join("DCode-IDE").join("extensions"))
}

fn extension_dir(namespace: &str, name: &str) -> Result<PathBuf, String> {
    if !registry::is_valid_id(namespace) || !registry::is_valid_id(name) {
        return Err("invalid extension id".into());
    }
    Ok(extensions_root()?.join(format!("{namespace}.{name}")))
}

fn split_id(id: &str) -> Result<(String, String), String> {
    let (namespace, name) = id.split_once('.').ok_or("invalid extension id")?;
    if !registry::is_valid_id(namespace) || !registry::is_valid_id(name) {
        return Err("invalid extension id".into());
    }
    Ok((namespace.to_string(), name.to_string()))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("could not create an HTTP client: {e}"))
}

async fn get_text(url: &str) -> Result<String, String> {
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("could not reach the extension registry: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "extension registry returned {}",
            response.status().as_u16()
        ));
    }
    response
        .text()
        .await
        .map_err(|e| format!("could not read the registry response: {e}"))
}

/// Returns `None` for a 404 so a caller can fall back to another URL.
async fn get_text_optional(url: &str) -> Result<Option<String>, String> {
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("could not reach the extension registry: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!(
            "extension registry returned {}",
            response.status().as_u16()
        ));
    }
    response
        .text()
        .await
        .map(Some)
        .map_err(|e| format!("could not read the registry response: {e}"))
}

/// Streams the package to disk: a bundled-binary extension can be hundreds of
/// megabytes and must not be held in memory.
fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .read_timeout(DOWNLOAD_IDLE_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("could not create an HTTP client: {e}"))
}

async fn download_to_file(url: &str, path: &Path) -> Result<(), String> {
    let response = download_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("could not download the extension: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "download failed with status {}",
            response.status().as_u16()
        ));
    }
    if let Some(len) = response.content_length() {
        if len > MAX_VSIX_BYTES {
            return Err("extension package is too large".into());
        }
    }

    let mut file = std::fs::File::create(path)
        .map_err(|e| format!("could not create {}: {e}", path.display()))?;
    let mut written: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let mb = written / (1024 * 1024);
            if e.is_timeout() {
                format!("download stalled after {mb} MB; check the connection and retry")
            } else {
                format!("download interrupted after {mb} MB: {e}")
            }
        })?;
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_VSIX_BYTES {
            return Err("extension package is too large".into());
        }
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("could not write the download: {e}"))?;
    }
    std::io::Write::flush(&mut file).map_err(|e| format!("could not flush the download: {e}"))?;
    Ok(())
}

fn digest_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not re-read the download: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer)
            .map_err(|e| format!("could not re-read the download: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(registry::hex_digest(&hasher.finalize()))
}

fn read_installed(dir: &Path) -> Option<InstalledExt> {
    let file_name = dir.file_name()?.to_str()?.to_string();
    file_name.split_once('.')?;
    let raw = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let manifest = manifest::parse_manifest(&raw).ok()?;
    let icon_path = manifest.icon.as_ref().and_then(|rel| {
        let resolved = resolve_inside(dir, rel).ok()?;
        resolved.exists().then(|| resolved.to_string_lossy().into())
    });
    Some(InstalledExt {
        id: file_name,
        dir: dir.to_string_lossy().into(),
        icon_path,
        manifest,
    })
}

/// Resolves a manifest-relative path and refuses anything outside `dir`.
fn resolve_inside(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let cleaned = relative.replace('\\', "/");
    let cleaned = cleaned.strip_prefix("./").unwrap_or(&cleaned);
    let Some(rel) = archive::safe_entry_path(&format!("extension/{cleaned}")) else {
        return Err("that file path is not allowed".into());
    };
    let target = dir.join(rel);
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("could not resolve the extension directory: {e}"))?;
    match target.canonicalize() {
        Ok(canonical) => {
            if canonical.starts_with(&canonical_dir) {
                Ok(canonical)
            } else {
                Err("that file path is not allowed".into())
            }
        }
        // Not on disk yet: the lexical form is already traversal-free.
        Err(_) => Ok(target),
    }
}

#[tauri::command]
pub async fn ext_search(
    query: String,
    size: u32,
    category: Option<String>,
) -> Result<Vec<ExtSummary>, String> {
    let query = registry::normalize_query(&query)?;
    let body = get_text(&registry::search_url(&query, size, category.as_deref())).await?;
    registry::parse_search(&body)
}

#[tauri::command]
pub async fn ext_install(
    namespace: String,
    name: String,
    version: Option<String>,
) -> Result<InstalledExt, String> {
    if !registry::is_valid_id(&namespace) || !registry::is_valid_id(&name) {
        return Err("invalid extension id".into());
    }
    if let Some(v) = version.as_deref() {
        if !registry::is_valid_version(v) {
            return Err("invalid extension version".into());
        }
    }

    // Ask for this machine's build first; extensions without per-platform
    // packages only answer on the unqualified URL.
    let target = registry::host_target_platform();
    let metadata = match get_text_optional(&registry::target_metadata_url(
        &namespace,
        &name,
        target,
        version.as_deref(),
    ))
    .await?
    {
        Some(body) => body,
        None => {
            get_text(&registry::metadata_url(
                &namespace,
                &name,
                version.as_deref(),
            ))
            .await?
        }
    };
    let release = registry::parse_release(&metadata)?;

    let dir = extension_dir(&namespace, &name)?;
    let staging = dir.with_extension("installing");
    if staging.exists() {
        std::fs::remove_dir_all(&staging)
            .map_err(|e| format!("could not clear the staging directory: {e}"))?;
    }
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("could not create {}: {e}", staging.display()))?;

    let package = staging.join("package.vsix");
    let outcome = install_package(&release, &package, &staging).await;
    let _ = std::fs::remove_file(&package);
    if let Err(error) = outcome {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    if !staging.join("package.json").exists() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("package has no extension manifest".into());
    }

    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("could not replace the previous version: {e}"))?;
    }
    std::fs::rename(&staging, &dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        format!("could not install the extension: {e}")
    })?;

    read_installed(&dir).ok_or_else(|| "installed package has an unreadable manifest".into())
}

async fn install_package(
    release: &registry::Release,
    package: &Path,
    staging: &Path,
) -> Result<(), String> {
    download_to_file(&release.download_url, package).await?;

    // The registry publishes a digest for most packages; when it does, a
    // package that does not match it is never unpacked.
    if let Some(url) = release.sha256_url.as_deref() {
        if let Some(expected) = registry::parse_expected_digest(&get_text(url).await?) {
            if digest_file(package)? != expected {
                return Err("package failed its checksum check".into());
            }
        }
    }

    let file = std::fs::File::open(package)
        .map_err(|e| format!("could not open the downloaded package: {e}"))?;
    archive::extract_payload(std::io::BufReader::new(file), staging)
}

#[tauri::command]
pub fn ext_list() -> Result<Vec<InstalledExt>, String> {
    let root = extensions_root()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries =
        std::fs::read_dir(&root).map_err(|e| format!("could not read {}: {e}", root.display()))?;
    let mut out: Vec<InstalledExt> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| read_installed(&e.path()))
        .collect();
    out.sort_by(|a, b| a.manifest.display_name.cmp(&b.manifest.display_name));
    Ok(out)
}

#[tauri::command]
pub fn ext_remove(id: String) -> Result<(), String> {
    let (namespace, name) = split_id(&id)?;
    let dir = extension_dir(&namespace, &name)?;
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("could not remove the extension: {e}"))
}

#[tauri::command]
pub fn ext_read_text(id: String, path: String) -> Result<String, String> {
    let (namespace, name) = split_id(&id)?;
    let dir = extension_dir(&namespace, &name)?;
    let target = resolve_inside(&dir, &path)?;
    let metadata = std::fs::metadata(&target)
        .map_err(|e| format!("could not read {}: {e}", target.display()))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err("that file is too large to read".into());
    }
    std::fs::read_to_string(&target)
        .map_err(|e| format!("could not read {}: {e}", target.display()))
}

/// Test-only hook so an integration test can drive real package extraction.
#[doc(hidden)]
pub fn extract_for_tests<R: std::io::Read + std::io::Seek>(
    source: R,
    dest: &Path,
) -> Result<(), String> {
    archive::extract_payload(source, dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_qualified_id() {
        assert_eq!(
            split_id("dracula-theme.theme-dracula"),
            Ok(("dracula-theme".into(), "theme-dracula".into()))
        );
        assert!(split_id("no-dot").is_err());
        assert!(split_id("../evil.x").is_err());
    }

    #[test]
    fn resolves_manifest_relative_paths_inside_the_extension() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        std::fs::create_dir_all(dir.join("themes")).expect("mkdir");
        std::fs::write(dir.join("themes/dark.json"), "{}").expect("write");

        let ok = resolve_inside(dir, "./themes/dark.json").expect("resolves");
        assert!(ok.ends_with("dark.json"));

        assert!(resolve_inside(dir, "../../../etc/passwd").is_err());
        assert!(resolve_inside(dir, "/etc/passwd").is_err());
    }
}

use std::io::{Read, Seek};
use std::path::{Component, Path, PathBuf};

/// VSIX payload lives under `extension/`; everything else is packaging metadata.
const PAYLOAD_PREFIX: &str = "extension/";
const MAX_ENTRIES: usize = 20_000;
// Extensions bundle native binaries: Claude Code ships a ~204 MB CLI in a
// ~215 MB payload. Entries stream to disk, so these bound disk, not memory.
const MAX_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;

/// Maps a zip entry name to the relative path it may be written to, or `None`
/// when the entry escapes the destination (zip-slip) or is not payload.
pub fn safe_entry_path(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let rest = normalized.strip_prefix(PAYLOAD_PREFIX)?;
    if rest.is_empty() || rest.ends_with('/') {
        return None;
    }
    if rest.starts_with('/') || rest.contains(':') || rest.contains('\0') {
        return None;
    }
    let path = Path::new(rest);
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn extract_payload<R: Read + Seek>(source: R, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(source).map_err(|e| format!("not a valid vsix: {e}"))?;
    if zip.len() > MAX_ENTRIES {
        return Err("vsix has too many entries".into());
    }

    let mut written: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("could not read vsix entry: {e}"))?;
        if !entry.is_file() {
            continue;
        }
        let Some(rel) = safe_entry_path(entry.name()) else {
            continue;
        };
        let size = entry.size();
        if size > MAX_FILE_BYTES {
            return Err(format!("{} is too large to install", rel.display()));
        }
        written = written.saturating_add(size);
        if written > MAX_UNCOMPRESSED_BYTES {
            return Err("vsix expands to too much data".into());
        }

        let target = dest.join(&rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        // Streamed, so a 200 MB bundled binary never lands in memory.
        let mut out = std::fs::File::create(&target)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
        drop(out);
        apply_unix_mode(&target, entry.unix_mode())?;
    }
    Ok(())
}

/// Zip stores the original mode; without it a bundled CLI loses its exec bit
/// and the extension cannot run its own binary.
pub fn permissions_for(mode: Option<u32>) -> u32 {
    match mode {
        Some(m) if m & 0o111 != 0 => 0o755,
        _ => 0o644,
    }
}

#[cfg(unix)]
fn apply_unix_mode(path: &Path, mode: Option<u32>) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(permissions_for(mode)))
        .map_err(|e| format!("could not set permissions on {}: {e}", path.display()))
}

#[cfg(not(unix))]
fn apply_unix_mode(_path: &Path, _mode: Option<u32>) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_payload_file() {
        assert_eq!(
            safe_entry_path("extension/package.json"),
            Some(PathBuf::from("package.json"))
        );
        assert_eq!(
            safe_entry_path("extension/themes/dark.json"),
            Some(PathBuf::from("themes/dark.json"))
        );
    }

    #[test]
    fn rejects_entries_outside_the_payload() {
        assert_eq!(safe_entry_path("[Content_Types].xml"), None);
        assert_eq!(safe_entry_path("extension.vsixmanifest"), None);
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        assert_eq!(safe_entry_path("extension/../../../etc/passwd"), None);
        assert_eq!(safe_entry_path("extension/a/../../b"), None);
        assert_eq!(safe_entry_path("extension//etc/passwd"), None);
        assert_eq!(safe_entry_path("extension/C:/windows/system32"), None);
        assert_eq!(safe_entry_path("extension/x\0y"), None);
    }

    #[test]
    fn rejects_directories_and_empty_names() {
        assert_eq!(safe_entry_path("extension/"), None);
        assert_eq!(safe_entry_path("extension/themes/"), None);
        assert_eq!(safe_entry_path(""), None);
    }

    #[test]
    fn keeps_the_executable_bit_for_bundled_binaries() {
        assert_eq!(permissions_for(Some(0o100755)), 0o755);
        assert_eq!(permissions_for(Some(0o755)), 0o755);
        assert_eq!(permissions_for(Some(0o100644)), 0o644);
        assert_eq!(permissions_for(None), 0o644);
    }

    #[test]
    fn normalizes_windows_separators() {
        assert_eq!(
            safe_entry_path("extension\\themes\\dark.json"),
            Some(PathBuf::from("themes/dark.json"))
        );
    }
}

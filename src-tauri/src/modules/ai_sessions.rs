//! AI chat transcripts, one JSON file per session under the app's local data
//! dir. A single shared store file had to be re-serialized whole on every save,
//! so write cost grew with total history instead of with the edited session.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const DIR_NAME: &str = "ai-sessions";
const EXT: &str = "json";
/// A transcript past this is refused rather than written; the frontend trims
/// tool output before saving, so only a runaway conversation gets here.
const MAX_BYTES: usize = 64 * 1024 * 1024;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Ids come from the webview, so they are restricted to a charset that cannot
/// name a path outside the sessions directory.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn file_for(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid session id".into());
    }
    Ok(dir.join(format!("{id}.{EXT}")))
}

pub(crate) fn read_at(dir: &Path, id: &str) -> Result<Option<String>, String> {
    let path = file_for(dir, id)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn write_at(dir: &Path, id: &str, json: &str) -> Result<(), String> {
    let path = file_for(dir, id)?;
    if json.len() > MAX_BYTES {
        return Err(format!(
            "session transcript is {} MB, over the {} MB limit",
            json.len() / (1024 * 1024),
            MAX_BYTES / (1024 * 1024)
        ));
    }
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{EXT}.tmp"));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| e.to_string())
}

pub(crate) fn delete_at(dir: &Path, id: &str) -> Result<(), String> {
    let path = file_for(dir, id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn list_at(dir: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut ids: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(&format!(".{EXT}"))?;
            valid_id(id).then(|| id.to_string())
        })
        .collect();
    ids.sort();
    Ok(ids)
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join(DIR_NAME))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_session_read(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = sessions_dir(&app)?;
    blocking(move || read_at(&dir, &id)).await
}

#[tauri::command]
pub async fn ai_session_write(app: AppHandle, id: String, json: String) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    blocking(move || write_at(&dir, &id, &json)).await
}

#[tauri::command]
pub async fn ai_session_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    blocking(move || delete_at(&dir, &id)).await
}

#[tauri::command]
pub async fn ai_session_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = sessions_dir(&app)?;
    blocking(move || list_at(&dir)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn ids_cannot_escape_the_sessions_dir() {
        for bad in ["", "../x", "a/b", "a\\b", "a.json", "..", "a b", "\u{e9}"] {
            assert!(!valid_id(bad), "{bad:?} must be rejected");
        }
        assert!(!valid_id(&"a".repeat(65)));
        assert!(valid_id("s-lx2k9-abc123"));
    }

    #[test]
    fn traversal_ids_are_refused_by_every_operation() {
        let tmp = TempDir::new().unwrap();
        assert!(read_at(tmp.path(), "../secret").is_err());
        assert!(write_at(tmp.path(), "../secret", "{}").is_err());
        assert!(delete_at(tmp.path(), "../secret").is_err());
        assert!(!tmp.path().parent().unwrap().join("secret.json").exists());
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_tmp() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("nested");
        write_at(&dir, "s-1", r#"[{"id":"m1"}]"#).unwrap();
        assert_eq!(
            read_at(&dir, "s-1").unwrap().as_deref(),
            Some(r#"[{"id":"m1"}]"#)
        );
        write_at(&dir, "s-1", "[]").unwrap();
        assert_eq!(read_at(&dir, "s-1").unwrap().as_deref(), Some("[]"));
        assert!(!dir.join("s-1.json.tmp").exists());
    }

    #[test]
    fn missing_session_reads_as_none_and_deletes_cleanly() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_at(tmp.path(), "s-missing").unwrap(), None);
        delete_at(tmp.path(), "s-missing").unwrap();
    }

    #[test]
    fn delete_removes_the_file() {
        let tmp = TempDir::new().unwrap();
        write_at(tmp.path(), "s-2", "[]").unwrap();
        delete_at(tmp.path(), "s-2").unwrap();
        assert_eq!(read_at(tmp.path(), "s-2").unwrap(), None);
    }

    #[test]
    fn list_returns_only_valid_session_files() {
        let tmp = TempDir::new().unwrap();
        write_at(tmp.path(), "s-b", "[]").unwrap();
        write_at(tmp.path(), "s-a", "[]").unwrap();
        fs::write(tmp.path().join("s-c.json.tmp"), "[]").unwrap();
        fs::write(tmp.path().join("notes.txt"), "x").unwrap();
        fs::write(tmp.path().join("bad name.json"), "[]").unwrap();
        assert_eq!(list_at(tmp.path()).unwrap(), vec!["s-a", "s-b"]);
        assert!(list_at(&tmp.path().join("absent")).unwrap().is_empty());
    }

    #[test]
    fn oversized_transcripts_are_refused() {
        let tmp = TempDir::new().unwrap();
        let big = "x".repeat(MAX_BYTES + 1);
        assert!(write_at(tmp.path(), "s-big", &big).is_err());
        assert_eq!(read_at(tmp.path(), "s-big").unwrap(), None);
    }
}

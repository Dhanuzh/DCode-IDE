mod node;
mod runtime;
pub mod webview;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

pub use runtime::{ExtHostEvent, ExtHostSession};

/// The JS host is embedded so it always matches the Rust side that drives it.
const HOST_SOURCE: &str = include_str!("../../../resources/exthost/host.mjs");

#[derive(Default)]
pub struct ExtHostState {
    session: Mutex<Option<std::sync::Arc<ExtHostSession>>>,
}

impl ExtHostState {
    pub fn shutdown(&self) {
        if let Some(session) = self.session.lock().ok().and_then(|mut s| s.take()) {
            session.kill();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtHostStatus {
    pub available: bool,
    pub node_path: Option<String>,
    pub node_version: Option<String>,
    pub detail: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateArgs {
    pub extension_id: String,
    pub extension_path: String,
    pub main: String,
    pub workspace_root: Option<String>,
    /// Prefix the webview scheme serves files from, e.g.
    /// `http://dcode-webview.localhost/`. Only the webview knows the platform
    /// form, so it is passed in and `asWebviewUri` builds real URLs with it.
    pub webview_url_prefix: Option<String>,
}

fn host_script_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("could not resolve the user data directory")?;
    Ok(base.join("DCode-IDE").join("exthost").join("host.mjs"))
}

/// Writes the embedded host next to the app data, so Node loads a real file.
fn ensure_host_script() -> Result<PathBuf, String> {
    let path = host_script_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    if current != HOST_SOURCE {
        std::fs::write(&path, HOST_SOURCE)
            .map_err(|e| format!("could not write the extension host: {e}"))?;
    }
    Ok(path)
}

fn find_node() -> Option<PathBuf> {
    which::which("node").ok()
}

fn node_version(node: &std::path::Path) -> Option<String> {
    let mut cmd = std::process::Command::new(node);
    cmd.arg("--version");
    crate::modules::proc::hide_console(&mut cmd);
    let output = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[tauri::command]
pub fn ext_host_status() -> ExtHostStatus {
    let Some(node) = find_node() else {
        return ExtHostStatus {
            available: false,
            node_path: None,
            node_version: None,
            detail: "Node.js was not found on PATH. Extensions with code need it to run.".into(),
        };
    };
    let version = node_version(&node);
    let supported = version.as_deref().is_some_and(node::is_supported_node);
    ExtHostStatus {
        available: supported,
        node_path: Some(node.to_string_lossy().into()),
        node_version: version.clone(),
        detail: if supported {
            format!(
                "Extension host ready on Node {}",
                version.unwrap_or_default()
            )
        } else {
            format!(
                "Node {} is too old; the extension host needs {}+",
                version.unwrap_or_else(|| "unknown".into()),
                node::MIN_NODE_MAJOR
            )
        },
    }
}

#[tauri::command]
pub fn ext_host_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExtHostState>,
    args: ActivateArgs,
    on_event: Channel<ExtHostEvent>,
) -> Result<(), String> {
    let status = ext_host_status();
    if !status.available {
        return Err(status.detail);
    }
    let node = find_node().ok_or("Node.js was not found on PATH")?;
    let script = ensure_host_script()?;

    let storage = dirs::data_dir()
        .ok_or("could not resolve the user data directory")?
        .join("DCode-IDE")
        .join("extension-storage")
        .join(&args.extension_id);
    std::fs::create_dir_all(&storage)
        .map_err(|e| format!("could not create extension storage: {e}"))?;

    // One host at a time for now: a second activation replaces the first.
    let mut slot = state
        .session
        .lock()
        .map_err(|_| "extension host state is poisoned")?;
    if let Some(previous) = slot.take() {
        previous.kill();
    }

    // Webview assets are served only from the extension that is running.
    if let Some(docs) = app.try_state::<webview::WebviewDocs>() {
        docs.set_root(Some(PathBuf::from(&args.extension_path)));
    }

    let session = runtime::spawn(app.clone(), &node, &script, on_event)?;
    session.activate(&args, &storage)?;
    *slot = Some(session);
    Ok(())
}

#[tauri::command]
pub fn ext_host_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExtHostState>,
) -> Result<(), String> {
    let mut slot = state
        .session
        .lock()
        .map_err(|_| "extension host state is poisoned")?;
    if let Some(session) = slot.take() {
        session.kill();
    }
    if let Some(docs) = app.try_state::<webview::WebviewDocs>() {
        docs.set_root(None);
    }
    Ok(())
}

/// The frontend rewrites a webview's HTML for our origin, then hands it back
/// so the `dcode-webview` scheme can serve it as a real document.
#[tauri::command]
pub fn ext_host_set_webview_html(
    app: tauri::AppHandle,
    view_id: String,
    html: String,
) -> Result<(), String> {
    let docs = app
        .try_state::<webview::WebviewDocs>()
        .ok_or("webview state is unavailable")?;
    docs.set_html(view_id, html);
    Ok(())
}

#[tauri::command]
pub fn ext_host_send(
    state: tauri::State<'_, ExtHostState>,
    message: serde_json::Value,
) -> Result<(), String> {
    let slot = state
        .session
        .lock()
        .map_err(|_| "extension host state is poisoned")?;
    let session = slot.as_ref().ok_or("the extension host is not running")?;
    session.send(&message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_host_script_is_complete() {
        assert!(HOST_SOURCE.contains("buildVscodeModule"));
        assert!(HOST_SOURCE.contains("registerCommand"));
        assert!(HOST_SOURCE.contains("Content-Length"));
    }

    #[test]
    fn status_reports_a_reason_when_unavailable() {
        let status = ext_host_status();
        assert!(status.available || !status.detail.is_empty());
    }
}

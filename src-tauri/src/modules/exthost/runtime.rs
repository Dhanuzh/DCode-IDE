use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::lsp::framing::FrameDecoder;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExtHostEvent {
    /// A JSON message from the host, forwarded verbatim to the webview.
    Message {
        payload: serde_json::Value,
    },
    Stderr {
        line: String,
    },
    Exit {
        code: Option<i32>,
    },
}

pub struct ExtHostSession {
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
    child: Arc<SharedChild>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    exited: Arc<AtomicBool>,
}

impl ExtHostSession {
    pub fn send(&self, message: &serde_json::Value) -> Result<(), String> {
        let body = serde_json::to_string(message).map_err(|e| e.to_string())?;
        let mut guard = self
            .stdin
            .lock()
            .map_err(|_| "extension host stdin is poisoned")?;
        let stdin = guard
            .as_mut()
            .ok_or("the extension host is no longer accepting input")?;
        write!(stdin, "Content-Length: {}\r\n\r\n{}", body.len(), body)
            .map_err(|e| format!("extension host write failed: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("extension host flush failed: {e}"))
    }

    pub fn activate(&self, args: &super::ActivateArgs, storage: &Path) -> Result<(), String> {
        self.send(&serde_json::json!({
            "type": "activate",
            "payload": {
                "extensionId": args.extension_id,
                "extensionPath": args.extension_path,
                "main": args.main,
                "workspaceRoot": args.workspace_root,
                "webviewUrlPrefix": args.webview_url_prefix,
                "storagePath": storage.to_string_lossy(),
            }
        }))
    }

    pub fn kill(&self) {
        if self.exited.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut guard) = self.stdin.lock() {
            guard.take();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for ExtHostSession {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn spawn(
    _app: tauri::AppHandle,
    node: &Path,
    script: &Path,
    on_event: Channel<ExtHostEvent>,
) -> Result<Arc<ExtHostSession>, String> {
    let mut cmd = Command::new(node);
    cmd.arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let child = Arc::new(
        SharedChild::spawn(&mut cmd)
            .map_err(|e| format!("could not start the extension host: {e}"))?,
    );
    let kill_on_fail = || {
        let _ = child.kill();
    };
    let stdin = child.take_stdin().ok_or_else(|| {
        kill_on_fail();
        "extension host: no stdin pipe".to_string()
    })?;
    let mut stdout = child.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "extension host: no stdout pipe".to_string()
    })?;
    let stderr = child.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "extension host: no stderr pipe".to_string()
    })?;

    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(j) => Some(j),
        Err(e) => {
            log::warn!("extension host job-object setup failed: {e}");
            None
        }
    };

    let exited = Arc::new(AtomicBool::new(false));
    let session = Arc::new(ExtHostSession {
        #[cfg(windows)]
        _job: job,
        child: child.clone(),
        stdin: Mutex::new(Some(stdin)),
        exited: exited.clone(),
    });

    let reader_events = on_event.clone();
    thread::Builder::new()
        .name("dcode-exthost-reader".into())
        .spawn(move || {
            let mut decoder = FrameDecoder::default();
            let mut buffer = [0u8; 16 * 1024];
            loop {
                let read = match std::io::Read::read(&mut stdout, &mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                match decoder.push(&buffer[..read]) {
                    Ok(frames) => {
                        for payload in frames {
                            match serde_json::from_str::<serde_json::Value>(&payload) {
                                Ok(value) => {
                                    let _ = reader_events
                                        .send(ExtHostEvent::Message { payload: value });
                                }
                                Err(e) => {
                                    let _ = reader_events.send(ExtHostEvent::Stderr {
                                        line: format!("host sent invalid JSON: {e}"),
                                    });
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = reader_events.send(ExtHostEvent::Stderr {
                            line: format!("host framing error: {e}"),
                        });
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("could not start the extension host reader: {e}"))?;

    let stderr_events = on_event.clone();
    thread::Builder::new()
        .name("dcode-exthost-stderr".into())
        .spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = stderr_events.send(ExtHostEvent::Stderr { line });
            }
        })
        .map_err(|e| format!("could not start the extension host stderr reader: {e}"))?;

    let wait_child = child.clone();
    let wait_exited = exited.clone();
    thread::Builder::new()
        .name("dcode-exthost-wait".into())
        .spawn(move || {
            let code = wait_child.wait().ok().and_then(|s| s.code());
            wait_exited.store(true, Ordering::SeqCst);
            let _ = on_event.send(ExtHostEvent::Exit { code });
        })
        .map_err(|e| format!("could not start the extension host waiter: {e}"))?;

    Ok(session)
}

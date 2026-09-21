//! "Sign in with Google" for the Vertex AI provider.
//!
//! Desktop OAuth2 flow per RFC 8252: PKCE + a loopback (127.0.0.1) redirect
//! listener, browser opened via `tauri-plugin-opener`. The resulting refresh
//! token is handed back to the frontend, which persists it through the
//! existing `secrets_set` keyring plumbing (see `keyring.ts`) — this module
//! never touches disk or the keychain itself.
//!
//! `oauth2.googleapis.com` / `www.googleapis.com` are hardcoded literals, not
//! user-supplied input, so this deliberately uses a plain `reqwest::Client`
//! rather than `net.rs`'s SSRF-hardened proxy (that machinery defends against
//! attacker-controlled hosts, which doesn't apply to our own fixed endpoints).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// Google issues a client_secret for "Desktop app" OAuth clients, but per
// Google's own installed-app guidance it isn't confidential (PKCE is the
// real protection) — same as how `gcloud` ships its own client id/secret.
// Fill these in with the Desktop OAuth client created in Google Cloud
// Console (APIs & Services -> Credentials -> Create OAuth client -> Desktop app).
const CLIENT_ID: &str = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
const CLIENT_SECRET: &str = "YOUR_GOOGLE_OAUTH_CLIENT_SECRET";

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

const OAUTH_TIMEOUT: Duration = Duration::from_secs(180);
const LISTENER_STACK_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VertexLoginResult {
    pub refresh_token: String,
    pub email: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VertexAccessToken {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: u64,
}

#[derive(Debug, Deserialize, Default)]
struct UserInfoResponse {
    #[serde(default)]
    email: String,
}

fn random_url_safe(len_bytes: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; len_bytes];
    getrandom::fill(&mut bytes).map_err(|e| format!("generate random bytes: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Owns the already-bound loopback listener and waits (in a dedicated
/// thread, bounded by `OAUTH_TIMEOUT`) for the OAuth redirect. Ignores stray
/// requests (e.g. a browser favicon fetch) that don't match `/callback` with
/// the expected `state`, and reports `error=` redirects (user cancelled) as
/// a normal failure rather than hanging until timeout.
fn spawn_callback_listener(
    listener: TcpListener,
    state_token: String,
) -> mpsc::Receiver<Result<String, String>> {
    let (tx, rx) = mpsc::sync_channel::<Result<String, String>>(1);
    let spawn_result = thread::Builder::new()
        .name("dcode-vertex-oauth-callback".into())
        .stack_size(LISTENER_STACK_BYTES)
        .spawn(move || {
            let deadline = Instant::now() + OAUTH_TIMEOUT;
            loop {
                if Instant::now() > deadline {
                    let _ = tx.send(Err("timed out waiting for Google sign-in".into()));
                    return;
                }
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(150));
                        continue;
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("oauth callback accept failed: {e}")));
                        return;
                    }
                };
                let _ = stream.set_nonblocking(false);

                let mut request_line = String::new();
                if BufReader::new(&stream).read_line(&mut request_line).is_err() {
                    continue;
                }
                let path = request_line.split_whitespace().nth(1).unwrap_or("");
                let query: std::collections::HashMap<String, String> =
                    reqwest::Url::parse(&format!("http://127.0.0.1{path}"))
                        .map(|u| u.query_pairs().into_owned().collect())
                        .unwrap_or_default();

                let (body, outcome) = if let Some(err) = query.get("error") {
                    (
                        format!("<html><body><p>Sign-in cancelled ({err}). You can close this tab.</p></body></html>"),
                        Some(Err(format!("Google sign-in was cancelled: {err}"))),
                    )
                } else if let (Some(code), Some(returned_state)) =
                    (query.get("code"), query.get("state"))
                {
                    if returned_state != &state_token {
                        (
                            "<html><body><p>Sign-in failed (state mismatch). You can close this tab.</p></body></html>".to_string(),
                            Some(Err("oauth state mismatch — possible CSRF, aborting".into())),
                        )
                    } else {
                        (
                            "<html><body><p>Signed in — you can close this tab and return to DCode-IDE.</p></body></html>".to_string(),
                            Some(Ok(code.clone())),
                        )
                    }
                } else {
                    ("<html><body>Not found</body></html>".to_string(), None)
                };

                let status = if outcome.is_some() { "200 OK" } else { "404 Not Found" };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(result) = outcome {
                    let _ = tx.send(result);
                    return;
                }
                // Stray request (favicon, etc.) — keep waiting for the real callback.
            }
        });
    if let Err(e) = spawn_result {
        // tx is dropped with the closure that never ran; send on a fresh
        // one-shot substitute isn't possible, so surface this via a second
        // channel write path: since spawn failed, rx.recv() below will see
        // a disconnected sender and the caller reports a generic failure.
        log::warn!("spawn oauth callback listener: {e}");
    }
    rx
}

#[tauri::command]
pub async fn vertex_oauth_login(app: AppHandle) -> Result<VertexLoginResult, String> {
    let verifier = random_url_safe(32)?;
    let challenge = pkce_challenge(&verifier);
    let state_token = random_url_safe(16)?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("bind oauth callback socket: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("read oauth callback address: {e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("configure oauth callback socket: {e}"))?;

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let mut auth_url = reqwest::Url::parse(AUTH_ENDPOINT).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state_token);

    let rx = spawn_callback_listener(listener, state_token);

    app.opener()
        .open_url(auth_url.to_string(), None::<&str>)
        .map_err(|e| format!("open browser for Google sign-in: {e}"))?;

    let joined = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(OAUTH_TIMEOUT + Duration::from_secs(5))
    })
    .await
    .map_err(|e| format!("oauth callback task error: {e}"))?;
    let thread_result = joined.map_err(|_| "timed out waiting for Google sign-in".to_string())?;
    let code = thread_result?;

    let client = reqwest::Client::new();
    let token_body = client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("exchange oauth code: {e}"))?
        .error_for_status()
        .map_err(|e| format!("exchange oauth code: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read oauth token response: {e}"))?;
    let token_resp: TokenResponse = serde_json::from_str(&token_body)
        .map_err(|e| format!("parse oauth token response: {e}"))?;

    let refresh_token = token_resp.refresh_token.ok_or_else(|| {
        "Google did not return a refresh token — sign out of the Vertex AI provider in Settings and sign in again".to_string()
    })?;

    let userinfo_body = client
        .get(USERINFO_ENDPOINT)
        .bearer_auth(&token_resp.access_token)
        .send()
        .await
        .map_err(|e| format!("fetch google userinfo: {e}"))?
        .text()
        .await
        .unwrap_or_default();
    let userinfo: UserInfoResponse = serde_json::from_str(&userinfo_body).unwrap_or_default();

    Ok(VertexLoginResult {
        refresh_token,
        email: userinfo.email,
    })
}

#[tauri::command]
pub async fn vertex_refresh_access_token(
    refresh_token: String,
) -> Result<VertexAccessToken, String> {
    let client = reqwest::Client::new();
    let token_body = client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("refresh vertex access token: {e}"))?
        .error_for_status()
        .map_err(|e| format!("refresh vertex access token: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read vertex token response: {e}"))?;
    let token_resp: TokenResponse = serde_json::from_str(&token_body)
        .map_err(|e| format!("parse vertex token response: {e}"))?;

    Ok(VertexAccessToken {
        access_token: token_resp.access_token,
        expires_in: token_resp.expires_in,
    })
}

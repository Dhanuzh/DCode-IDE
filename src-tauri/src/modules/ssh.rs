//! Host discovery for the SSH connect dialog. Connections themselves run the
//! system `ssh` client inside a terminal tab, so authentication, agents, keys
//! and known_hosts prompts all behave exactly as in any other terminal. This
//! module only lists the concrete `Host` aliases from the user's ssh config.

use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_INCLUDE_DEPTH: usize = 4;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    pub alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ParsedConfig {
    pub hosts: Vec<SshHost>,
    pub includes: Vec<String>,
}

/// Splits a config line into its keyword and arguments. `Key=value`,
/// `Key value` and double-quoted arguments are all accepted.
fn tokenize(line: &str) -> Option<(String, Vec<String>)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let keyword = line[..split].to_ascii_lowercase();
    let rest = line[split..].trim_start_matches(|c: char| c.is_whitespace() || c == '=');
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut has_token = false;
    for c in rest.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                has_token = true;
            }
            c if c.is_whitespace() && !quoted => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        args.push(current);
    }
    Some((keyword, args))
}

fn is_concrete_alias(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.starts_with('!')
        && !pattern.starts_with('-')
        && !pattern.contains(['*', '?'])
        && pattern
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@' | ':'))
}

pub(crate) fn parse_config(text: &str) -> ParsedConfig {
    let mut out = ParsedConfig::default();
    // Indices into `out.hosts` that the current `Host` block applies to.
    let mut current: Vec<usize> = Vec::new();
    for raw in text.lines() {
        let Some((keyword, args)) = tokenize(raw) else {
            continue;
        };
        match keyword.as_str() {
            "host" => {
                current.clear();
                for pattern in &args {
                    if !is_concrete_alias(pattern) {
                        continue;
                    }
                    if let Some(idx) = out.hosts.iter().position(|h| &h.alias == pattern) {
                        current.push(idx);
                    } else {
                        out.hosts.push(SshHost {
                            alias: pattern.clone(),
                            hostname: None,
                            user: None,
                            port: None,
                        });
                        current.push(out.hosts.len() - 1);
                    }
                }
            }
            "match" => current.clear(),
            "include" => out.includes.extend(args),
            // ssh uses the first value it obtains for each parameter.
            "hostname" | "user" | "port" => {
                let Some(value) = args.first() else { continue };
                for &idx in &current {
                    let host = &mut out.hosts[idx];
                    match keyword.as_str() {
                        "hostname" if host.hostname.is_none() => {
                            host.hostname = Some(value.clone());
                        }
                        "user" if host.user.is_none() => host.user = Some(value.clone()),
                        "port" if host.port.is_none() => host.port = value.parse().ok(),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// `*` and `?` wildcard match for a single path component.
fn glob_match(pattern: &str, name: &str) -> bool {
    fn go(p: &[char], n: &[char]) -> bool {
        match (p.first(), n.first()) {
            (None, None) => true,
            (Some('*'), _) => go(&p[1..], n) || (!n.is_empty() && go(p, &n[1..])),
            (Some('?'), Some(_)) => go(&p[1..], &n[1..]),
            (Some(a), Some(b)) if a == b => go(&p[1..], &n[1..]),
            _ => false,
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    go(&p, &n)
}

/// Files an `Include` argument names. Relative paths resolve against the
/// user's `~/.ssh`; wildcards are honoured in the final component only.
pub(crate) fn resolve_include(arg: &str, home: &Path) -> Vec<PathBuf> {
    let expanded = if let Some(rest) = arg.strip_prefix("~/") {
        home.join(rest)
    } else {
        let p = PathBuf::from(arg);
        if p.is_absolute() {
            p
        } else {
            home.join(".ssh").join(p)
        }
    };
    let Some(name) = expanded.file_name().and_then(|n| n.to_str()) else {
        return Vec::new();
    };
    if !name.contains(['*', '?']) {
        return vec![expanded];
    }
    let Some(dir) = expanded.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| glob_match(name, n) && !n.starts_with('.'))
        })
        .map(|e| e.path())
        .collect();
    files.sort();
    files
}

fn collect(
    path: &Path,
    home: &Path,
    depth: usize,
    seen: &mut Vec<PathBuf>,
    hosts: &mut Vec<SshHost>,
) {
    if depth > MAX_INCLUDE_DEPTH || seen.len() >= MAX_FILES || seen.iter().any(|p| p == path) {
        return;
    }
    seen.push(path.to_path_buf());
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let parsed = parse_config(&text);
    for host in parsed.hosts {
        if !hosts.iter().any(|h| h.alias == host.alias) {
            hosts.push(host);
        }
    }
    for include in parsed.includes {
        for file in resolve_include(&include, home) {
            collect(&file, home, depth + 1, seen, hosts);
        }
    }
}

pub(crate) fn hosts_from(home: &Path) -> Vec<SshHost> {
    let mut hosts = Vec::new();
    let mut seen = Vec::new();
    collect(
        &home.join(".ssh").join("config"),
        home,
        0,
        &mut seen,
        &mut hosts,
    );
    hosts
}

#[tauri::command]
pub async fn ssh_config_hosts() -> Result<Vec<SshHost>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    tauri::async_runtime::spawn_blocking(move || hosts_from(&home))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn host(alias: &str) -> SshHost {
        SshHost {
            alias: alias.into(),
            hostname: None,
            user: None,
            port: None,
        }
    }

    #[test]
    fn parses_concrete_hosts_and_their_basics() {
        let parsed = parse_config(
            "# comment\n\
             Host prod prod-alt\n\
             \tHostName 10.0.0.5\n\
             \tUser deploy\n\
             \tPort=2222\n\
             \tHostName ignored-second-value\n\
             Host *.internal !bad staging\n\
             \tUser ops\n",
        );
        assert_eq!(
            parsed.hosts,
            vec![
                SshHost {
                    alias: "prod".into(),
                    hostname: Some("10.0.0.5".into()),
                    user: Some("deploy".into()),
                    port: Some(2222),
                },
                SshHost {
                    alias: "prod-alt".into(),
                    hostname: Some("10.0.0.5".into()),
                    user: Some("deploy".into()),
                    port: Some(2222),
                },
                SshHost {
                    alias: "staging".into(),
                    user: Some("ops".into()),
                    ..host("staging")
                },
            ]
        );
    }

    #[test]
    fn match_blocks_do_not_leak_into_the_previous_host() {
        let parsed = parse_config("Host a\nMatch exec true\nUser root\n");
        assert_eq!(parsed.hosts, vec![host("a")]);
    }

    #[test]
    fn rejects_patterns_and_unsafe_aliases() {
        let parsed = parse_config("Host * ? -oProxyCommand=x a;b \"two words\" ok\n");
        assert_eq!(parsed.hosts, vec![host("ok")]);
    }

    #[test]
    fn keywords_are_case_insensitive_and_bad_ports_ignored() {
        let parsed = parse_config("HOST box\nPORT notanumber\nuser me\n");
        assert_eq!(
            parsed.hosts,
            vec![SshHost {
                user: Some("me".into()),
                ..host("box")
            }]
        );
    }

    #[test]
    fn collects_include_arguments() {
        let parsed = parse_config("Include config.d/* ~/.ssh/extra\n");
        assert_eq!(parsed.includes, vec!["config.d/*", "~/.ssh/extra"]);
    }

    #[test]
    fn glob_matches_single_components() {
        assert!(glob_match("*", "work"));
        assert!(glob_match("*.conf", "a.conf"));
        assert!(glob_match("h?st", "host"));
        assert!(!glob_match("*.conf", "a.txt"));
    }

    #[test]
    fn follows_includes_and_stops_on_cycles() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path();
        let ssh = home.join(".ssh");
        std::fs::create_dir_all(ssh.join("config.d")).unwrap();
        std::fs::write(ssh.join("config"), "Include config.d/*\nHost main\n").unwrap();
        std::fs::write(ssh.join("config.d/a"), "Host a\nInclude ~/.ssh/config\n").unwrap();
        std::fs::write(ssh.join("config.d/b"), "Host b main\nUser x\n").unwrap();
        std::fs::write(ssh.join("config.d/.hidden"), "Host hidden\n").unwrap();
        let aliases: Vec<String> = hosts_from(home).into_iter().map(|h| h.alias).collect();
        assert_eq!(aliases, vec!["main", "a", "b"]);
    }

    #[test]
    fn missing_config_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(hosts_from(tmp.path()).is_empty());
    }
}

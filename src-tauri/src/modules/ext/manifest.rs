use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContribution {
    pub label: String,
    /// `vs` (light), `vs-dark` or `hc-black` in VS Code terms.
    pub ui_theme: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IconThemeContribution {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub icon: Option<String>,
    /// Node entrypoint, when the extension ships code.
    pub main: Option<String>,
    pub themes: Vec<ThemeContribution>,
    pub icon_themes: Vec<IconThemeContribution>,
    pub grammar_count: usize,
    pub snippet_count: usize,
    /// The extension ships activation code we cannot run (no extension host).
    pub has_code: bool,
}

fn str_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(|s| s.to_string())
}

pub fn parse_manifest(raw: &str) -> Result<ManifestInfo, String> {
    let json: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("package.json is not valid JSON: {e}"))?;
    let name = str_field(&json, "name").ok_or("package.json has no name")?;
    let publisher = str_field(&json, "publisher").unwrap_or_default();
    let version = str_field(&json, "version").unwrap_or_else(|| "0.0.0".into());
    let display_name = str_field(&json, "displayName").unwrap_or_else(|| name.clone());
    let description = str_field(&json, "description").unwrap_or_default();
    let icon = str_field(&json, "icon");
    let main = str_field(&json, "main");
    let has_code = main.is_some() || json.get("browser").is_some();

    let contributes = json.get("contributes");
    let mut themes = Vec::new();
    let mut icon_themes = Vec::new();
    let mut grammar_count = 0;
    let mut snippet_count = 0;

    if let Some(contributes) = contributes {
        if let Some(list) = contributes.get("themes").and_then(|v| v.as_array()) {
            for item in list {
                let Some(path) = str_field(item, "path") else {
                    continue;
                };
                let label = str_field(item, "label").unwrap_or_else(|| display_name.clone());
                let ui_theme = str_field(item, "uiTheme").unwrap_or_else(|| "vs-dark".into());
                themes.push(ThemeContribution {
                    label,
                    ui_theme,
                    path,
                });
            }
        }
        if let Some(list) = contributes.get("iconThemes").and_then(|v| v.as_array()) {
            for item in list {
                let Some(path) = str_field(item, "path") else {
                    continue;
                };
                let id = str_field(item, "id").unwrap_or_else(|| name.clone());
                let label = str_field(item, "label").unwrap_or_else(|| id.clone());
                icon_themes.push(IconThemeContribution { id, label, path });
            }
        }
        grammar_count = contributes
            .get("grammars")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        snippet_count = contributes
            .get("snippets")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
    }

    Ok(ManifestInfo {
        name,
        publisher,
        version,
        display_name,
        description,
        icon,
        main,
        themes,
        icon_themes,
        grammar_count,
        snippet_count,
        has_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_identity_and_theme_contributions() {
        let raw = r#"{
            "name": "dracula-theme",
            "publisher": "dracula-theme",
            "version": "2.24.3",
            "displayName": "Dracula Official",
            "description": "Official Dracula Theme.",
            "icon": "icon.png",
            "contributes": {
                "themes": [
                    { "label": "Dracula", "uiTheme": "vs-dark", "path": "./theme/dracula.json" }
                ]
            }
        }"#;
        let info = parse_manifest(raw).expect("parses");
        assert_eq!(info.name, "dracula-theme");
        assert_eq!(info.display_name, "Dracula Official");
        assert_eq!(info.icon.as_deref(), Some("icon.png"));
        assert!(!info.has_code);
        assert_eq!(
            info.themes,
            vec![ThemeContribution {
                label: "Dracula".into(),
                ui_theme: "vs-dark".into(),
                path: "./theme/dracula.json".into(),
            }]
        );
    }

    #[test]
    fn flags_extensions_that_ship_activation_code() {
        let raw = r#"{ "name": "x", "main": "./out/extension.js" }"#;
        let info = parse_manifest(raw).expect("parses");
        assert!(info.has_code);
        assert_eq!(info.main.as_deref(), Some("./out/extension.js"));
    }

    #[test]
    fn defaults_missing_optional_fields() {
        let info = parse_manifest(r#"{ "name": "bare" }"#).expect("parses");
        assert_eq!(info.display_name, "bare");
        assert_eq!(info.version, "0.0.0");
        assert!(info.themes.is_empty());
        assert!(info.icon_themes.is_empty());
        assert_eq!(info.grammar_count, 0);
    }

    #[test]
    fn skips_theme_entries_without_a_path() {
        let raw = r#"{ "name": "x", "contributes": { "themes": [{ "label": "no path" }] } }"#;
        assert!(parse_manifest(raw).expect("parses").themes.is_empty());
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(parse_manifest("{ not json").is_err());
    }

    #[test]
    fn counts_grammars_and_snippets() {
        let raw = r#"{
            "name": "x",
            "contributes": {
                "grammars": [{ "language": "rs" }, { "language": "toml" }],
                "snippets": [{ "language": "rs", "path": "./s.json" }]
            }
        }"#;
        let info = parse_manifest(raw).expect("parses");
        assert_eq!(info.grammar_count, 2);
        assert_eq!(info.snippet_count, 1);
    }
}

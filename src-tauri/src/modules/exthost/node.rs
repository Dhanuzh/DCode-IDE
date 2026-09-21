/// Minimum Node the shim relies on (structuredClone, `node:` prefixes, modern
/// class fields in bundled extensions).
pub const MIN_NODE_MAJOR: u32 = 18;

/// Parses `node --version` output (`v22.14.0`) into its major version.
pub fn parse_node_major(output: &str) -> Option<u32> {
    let trimmed = output.trim();
    let digits = trimmed.strip_prefix('v').unwrap_or(trimmed);
    digits.split('.').next()?.parse::<u32>().ok()
}

pub fn is_supported_node(output: &str) -> bool {
    parse_node_major(output).is_some_and(|major| major >= MIN_NODE_MAJOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_version_string() {
        assert_eq!(parse_node_major("v22.14.0\n"), Some(22));
        assert_eq!(parse_node_major("18.0.0"), Some(18));
        assert_eq!(parse_node_major("not a version"), None);
        assert_eq!(parse_node_major(""), None);
    }

    #[test]
    fn enforces_the_minimum_major() {
        assert!(is_supported_node("v22.0.0"));
        assert!(is_supported_node("v18.19.1"));
        assert!(!is_supported_node("v16.20.0"));
        assert!(!is_supported_node("garbage"));
    }
}

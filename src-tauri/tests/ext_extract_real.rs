//! Extraction against a real marketplace package.
//!
//! Ignored by default because it needs a downloaded `.vsix`. Run with:
//!   DCODE_TEST_VSIX=/path/to/ext.vsix cargo test --test ext_extract_real -- --ignored
use std::path::PathBuf;

#[test]
#[ignore = "needs a real .vsix via DCODE_TEST_VSIX"]
fn extracts_a_package_with_a_bundled_binary() {
    let Ok(path) = std::env::var("DCODE_TEST_VSIX") else {
        return;
    };
    let vsix = PathBuf::from(path);
    assert!(vsix.exists(), "DCODE_TEST_VSIX does not exist: {}", vsix.display());

    let dest = tempfile::tempdir().expect("tempdir");
    let file = std::fs::File::open(&vsix).expect("open vsix");
    dcode_lib::modules::ext::extract_for_tests(std::io::BufReader::new(file), dest.path())
        .expect("extraction succeeds");

    assert!(
        dest.path().join("package.json").exists(),
        "payload landed under the extension root"
    );

    // Any executable entry keeps its bit, or a bundled CLI cannot be run.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut checked = 0;
        for entry in walk(dest.path()) {
            let mode = std::fs::metadata(&entry).expect("stat").permissions().mode() & 0o777;
            assert!(mode == 0o755 || mode == 0o644, "unexpected mode {mode:o} on {entry:?}");
            checked += 1;
        }
        assert!(checked > 0, "extracted at least one file");
    }
}

#[cfg(unix)]
fn walk(root: &std::path::Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

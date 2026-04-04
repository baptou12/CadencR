use std::fs;
use tempfile::TempDir;

use cadence_service::domain::editor::service;

fn setup_test_dir() -> TempDir {
    let dir = TempDir::new().unwrap();
    let base = dir.path();

    // Create a few files with known names
    fs::create_dir_all(base.join("src")).unwrap();
    fs::write(base.join("src/main.rs"), "fn main() {}").unwrap();
    fs::write(base.join("src/lib.rs"), "pub mod foo;").unwrap();
    fs::write(base.join("README.md"), "# hello").unwrap();

    // Touch main.rs last so it's the most recent
    std::thread::sleep(std::time::Duration::from_millis(50));
    fs::write(base.join("src/main.rs"), "fn main() { updated }").unwrap();

    dir
}

#[test]
fn recent_files_returns_files_sorted_by_mtime() {
    let dir = setup_test_dir();
    let path = dir.path().to_str().unwrap();

    let files = service::recent_files(path, 10).unwrap();

    assert!(!files.is_empty());
    // main.rs was touched last, should be first
    assert_eq!(files[0], "src/main.rs");
}

#[test]
fn recent_files_respects_limit() {
    let dir = setup_test_dir();
    let path = dir.path().to_str().unwrap();

    let files = service::recent_files(path, 1).unwrap();
    assert_eq!(files.len(), 1);
}

#[test]
fn fuzzy_search_finds_matching_files() {
    let dir = setup_test_dir();
    let path = dir.path().to_str().unwrap();

    let results = service::fuzzy_search_files(path, "main", 10).unwrap();

    assert!(!results.is_empty());
    assert!(results[0].path.contains("main"));
    assert!(!results[0].positions.is_empty());
}

#[test]
fn fuzzy_search_returns_empty_for_no_match() {
    let dir = setup_test_dir();
    let path = dir.path().to_str().unwrap();

    let results = service::fuzzy_search_files(path, "zzzznotfound", 10).unwrap();
    assert!(results.is_empty());
}

#[test]
fn fuzzy_search_respects_limit() {
    let dir = setup_test_dir();
    let path = dir.path().to_str().unwrap();

    let results = service::fuzzy_search_files(path, "rs", 1).unwrap();
    assert_eq!(results.len(), 1);
}

#[test]
fn recent_files_errors_on_invalid_path() {
    let result = service::recent_files("/nonexistent/path/xyz", 10);
    assert!(result.is_err());
}

#[test]
fn fuzzy_search_errors_on_invalid_path() {
    let result = service::fuzzy_search_files("/nonexistent/path/xyz", "test", 10);
    assert!(result.is_err());
}

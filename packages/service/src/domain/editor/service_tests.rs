#[cfg(test)]
mod tests {
    use super::super::routes::ContentSearchParams;
    use super::super::service;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_test_project() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("hello.rs"),
            "fn main() {\n    println!(\"Hello, world!\");\n}\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("lib.rs"),
            "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("test.txt"),
            "This is a test file\nWith multiple lines\nFor searching\n",
        )
        .unwrap();
        let canonical = fs::canonicalize(dir.path()).unwrap();
        (dir, canonical)
    }

    fn default_params(query: &str) -> ContentSearchParams {
        ContentSearchParams {
            project_id: 0,
            feature_id: None,
            query: query.to_string(),
            case_sensitive: false,
            whole_word: false,
            is_regex: false,
            respect_gitignore: false,
            include_pattern: None,
            exclude_pattern: None,
            limit: 500,
        }
    }

    #[test]
    fn finds_basic_match() {
        let (_dir, root) = create_test_project();
        let params = default_params("Hello");
        let result = service::content_search(&root, &params).unwrap();

        assert!(!result.matches.is_empty(), "should find at least one match");
        let m = &result.matches[0];
        assert!(m.line_content.contains("Hello"));
        assert!(m.match_start < m.match_end);
    }

    #[test]
    fn case_insensitive_by_default() {
        let (_dir, root) = create_test_project();
        let params = default_params("hello");
        let result = service::content_search(&root, &params).unwrap();

        assert!(
            !result.matches.is_empty(),
            "case-insensitive should match 'Hello'"
        );
    }

    #[test]
    fn case_sensitive_filters() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("hello");
        params.case_sensitive = true;
        let result = service::content_search(&root, &params).unwrap();

        assert!(
            result.matches.is_empty(),
            "case-sensitive 'hello' should not match 'Hello'"
        );
    }

    #[test]
    fn whole_word_match() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("test");
        params.whole_word = true;
        let result = service::content_search(&root, &params).unwrap();

        // Should match "test" in test.txt but not partial matches
        for m in &result.matches {
            assert!(
                m.line_content.contains("test"),
                "all matches should contain whole word 'test'"
            );
        }
    }

    #[test]
    fn regex_search() {
        let (_dir, root) = create_test_project();
        let mut params = default_params(r"fn \w+");
        params.is_regex = true;
        let result = service::content_search(&root, &params).unwrap();

        assert!(
            !result.matches.is_empty(),
            "regex should match function declarations"
        );
    }

    #[test]
    fn context_lines_returned() {
        let (_dir, root) = create_test_project();
        let params = default_params("multiple");
        let result = service::content_search(&root, &params).unwrap();

        assert!(!result.matches.is_empty());
        let m = &result.matches[0];
        assert!(
            !m.context_before.is_empty(),
            "should have context lines before"
        );
        assert!(
            !m.context_after.is_empty(),
            "should have context lines after"
        );
    }

    #[test]
    fn limit_truncates() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("a");
        params.limit = 1;
        let result = service::content_search(&root, &params).unwrap();

        assert!(
            result.truncated,
            "should be truncated when matches exceed limit"
        );
    }

    #[test]
    fn include_pattern_filters() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("fn");
        params.include_pattern = Some("*.rs".to_string());
        let result = service::content_search(&root, &params).unwrap();

        for m in &result.matches {
            assert!(
                m.path.ends_with(".rs"),
                "include *.rs should only return .rs files, got {}",
                m.path
            );
        }
    }

    #[test]
    fn exclude_pattern_filters() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("fn");
        params.exclude_pattern = Some("*.txt".to_string());
        let result = service::content_search(&root, &params).unwrap();

        for m in &result.matches {
            assert!(
                !m.path.ends_with(".txt"),
                "exclude *.txt should not return .txt files"
            );
        }
    }

    #[test]
    fn skips_binary_files() {
        let (_dir, root) = create_test_project();
        fs::write(root.join("binary.bin"), b"hello\x00world").unwrap();

        let params = default_params("hello");
        let result = service::content_search(&root, &params).unwrap();

        for m in &result.matches {
            assert!(!m.path.contains("binary.bin"), "should skip binary files");
        }
    }

    #[test]
    fn invalid_regex_returns_error() {
        let (_dir, root) = create_test_project();
        let mut params = default_params("[invalid");
        params.is_regex = true;
        let result = service::content_search(&root, &params);

        assert!(result.is_err(), "invalid regex should return error");
    }

    #[test]
    fn empty_query_returns_nothing() {
        let (_dir, root) = create_test_project();
        let params = default_params("");
        let result = service::content_search(&root, &params).unwrap();

        assert!(
            result.matches.is_empty(),
            "empty query should match nothing"
        );
    }

    #[cfg(unix)]
    #[test]
    fn no_follow_write_rejects_existing_symlink_target() {
        use std::os::unix::fs::symlink;

        let (dir, root) = create_test_project();
        let outside = TempDir::new().unwrap();
        let victim = outside.path().join("victim");
        fs::write(&victim, "outside").unwrap();
        symlink(&victim, dir.path().join("linked.txt")).unwrap();

        let target = service::validate_path_for_write(&root, "linked.txt").unwrap();
        service::write_file_no_follow(&target, b"replacement", service::FileWriteMode::Replace)
            .unwrap_err();
        assert_eq!(fs::read_to_string(victim).unwrap(), "outside");
    }

    #[test]
    fn create_new_write_is_atomic_and_preserves_existing_content() {
        let (dir, _root) = create_test_project();
        let target = dir.path().join("existing.txt");
        fs::write(&target, "original").unwrap();

        let error = service::write_file_no_follow(
            &target,
            b"replacement",
            service::FileWriteMode::CreateNew,
        )
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(target).unwrap(), "original");
    }
}

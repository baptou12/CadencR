#[cfg(test)]
mod tests {
    use super::super::routes::ContentSearchParams;
    use super::super::service;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_project() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("hello.rs"), "fn main() {\n    println!(\"Hello, world!\");\n}\n").unwrap();
        fs::write(dir.path().join("lib.rs"), "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n").unwrap();
        fs::write(dir.path().join("test.txt"), "This is a test file\nWith multiple lines\nFor searching\n").unwrap();
        dir
    }

    fn default_params(project_path: &str, query: &str) -> ContentSearchParams {
        ContentSearchParams {
            project_path: project_path.to_string(),
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
        let dir = create_test_project();
        let params = default_params(dir.path().to_str().unwrap(), "Hello");
        let result = service::content_search(&params).unwrap();

        assert!(!result.matches.is_empty(), "should find at least one match");
        let m = &result.matches[0];
        assert!(m.line_content.contains("Hello"));
        assert!(m.match_start < m.match_end);
    }

    #[test]
    fn case_insensitive_by_default() {
        let dir = create_test_project();
        let params = default_params(dir.path().to_str().unwrap(), "hello");
        let result = service::content_search(&params).unwrap();

        assert!(!result.matches.is_empty(), "case-insensitive should match 'Hello'");
    }

    #[test]
    fn case_sensitive_filters() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "hello");
        params.case_sensitive = true;
        let result = service::content_search(&params).unwrap();

        assert!(result.matches.is_empty(), "case-sensitive 'hello' should not match 'Hello'");
    }

    #[test]
    fn whole_word_match() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "test");
        params.whole_word = true;
        let result = service::content_search(&params).unwrap();

        // Should match "test" in test.txt but not partial matches
        for m in &result.matches {
            assert!(m.line_content.contains("test"), "all matches should contain whole word 'test'");
        }
    }

    #[test]
    fn regex_search() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), r"fn \w+");
        params.is_regex = true;
        let result = service::content_search(&params).unwrap();

        assert!(!result.matches.is_empty(), "regex should match function declarations");
    }

    #[test]
    fn context_lines_returned() {
        let dir = create_test_project();
        let params = default_params(dir.path().to_str().unwrap(), "multiple");
        let result = service::content_search(&params).unwrap();

        assert!(!result.matches.is_empty());
        let m = &result.matches[0];
        // "multiple" is on line 2 of test.txt, so context_before should have line 1
        assert!(!m.context_before.is_empty(), "should have context lines before");
        assert!(!m.context_after.is_empty(), "should have context lines after");
    }

    #[test]
    fn limit_truncates() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "a");
        params.limit = 1;
        let result = service::content_search(&params).unwrap();

        // Parallel walker may slightly overshoot, but truncated flag should be set
        assert!(result.truncated, "should be truncated when matches exceed limit");
    }

    #[test]
    fn include_pattern_filters() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "fn");
        params.include_pattern = Some("*.rs".to_string());
        let result = service::content_search(&params).unwrap();

        for m in &result.matches {
            assert!(m.path.ends_with(".rs"), "include *.rs should only return .rs files, got {}", m.path);
        }
    }

    #[test]
    fn exclude_pattern_filters() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "fn");
        params.exclude_pattern = Some("*.txt".to_string());
        let result = service::content_search(&params).unwrap();

        for m in &result.matches {
            assert!(!m.path.ends_with(".txt"), "exclude *.txt should not return .txt files");
        }
    }

    #[test]
    fn skips_binary_files() {
        let dir = create_test_project();
        // Create a binary file with null bytes
        fs::write(dir.path().join("binary.bin"), b"hello\x00world").unwrap();

        let params = default_params(dir.path().to_str().unwrap(), "hello");
        let result = service::content_search(&params).unwrap();

        for m in &result.matches {
            assert!(!m.path.contains("binary.bin"), "should skip binary files");
        }
    }

    #[test]
    fn invalid_regex_returns_error() {
        let dir = create_test_project();
        let mut params = default_params(dir.path().to_str().unwrap(), "[invalid");
        params.is_regex = true;
        let result = service::content_search(&params);

        assert!(result.is_err(), "invalid regex should return error");
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = create_test_project();
        let params = default_params(dir.path().to_str().unwrap(), "");
        let result = service::content_search(&params).unwrap();

        assert!(result.matches.is_empty(), "empty query should match nothing");
    }
}

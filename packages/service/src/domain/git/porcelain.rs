//! Porcelain v2 parsers shared by the Git workflow endpoints.
//!
//! `git_status::compute_status` parses the same format for the WS snapshot;
//! the file-list parser here is the per-row variant used by the commit
//! dialog (`GET /api/git/uncommitted-files`). Format spec:
//! <https://git-scm.com/docs/git-status>.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::models::{ConflictKind, FileStageState};

/// One row per uncommitted file. `status` is one of `"staged"`, `"unstaged"`,
/// `"untracked"`, or `"both"` (staged + further unstaged change). `change_kind`
/// is the porcelain v2 letter mapped to a friendly token: `"added"`,
/// `"modified"`, `"deleted"`, `"renamed"`, or `"untracked"`.
///
/// `additions`/`deletions` are filled from `git diff --numstat` (sum of staged
/// and unstaged sides). They are `0` for untracked files (numstat doesn't
/// cover them) and for binary files (where numstat reports `-`).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UncommittedFile {
    pub path: String,
    pub status: String,
    pub change_kind: String,
    #[serde(default)]
    pub additions: i32,
    #[serde(default)]
    pub deletions: i32,
    /// Typed equivalent of `status`; new consumers should prefer this field.
    #[serde(default)]
    pub stage_state: FileStageState,
    /// Canonical porcelain-v2 unmerged `XY` kind when the row is conflicted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_kind: Option<ConflictKind>,
}

/// Parse `git status --porcelain=v2` into a list of `UncommittedFile`s.
pub fn parse_porcelain_v2_files(output: &str) -> Vec<UncommittedFile> {
    let mut out: Vec<UncommittedFile> = Vec::new();
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("? ") {
            out.push(UncommittedFile {
                path: path.to_string(),
                status: "untracked".to_string(),
                change_kind: "untracked".to_string(),
                additions: 0,
                deletions: 0,
                stage_state: FileStageState::Untracked,
                conflict_kind: None,
            });
        } else if let Some(rest) = line.strip_prefix("1 ") {
            push_changed_entry(rest, /* renamed */ false, &mut out);
        } else if let Some(rest) = line.strip_prefix("2 ") {
            push_changed_entry(rest, /* renamed */ true, &mut out);
        } else if let Some(rest) = line.strip_prefix("u ") {
            if let Some(path) = unmerged_path(rest) {
                out.push(UncommittedFile {
                    path,
                    status: "both".to_string(),
                    change_kind: "modified".to_string(),
                    additions: 0,
                    deletions: 0,
                    stage_state: FileStageState::Conflicted,
                    conflict_kind: parse_conflict_kind(rest),
                });
            }
        }
    }
    out
}

/// Map a porcelain v2 XY pair to (status, change_kind). For ordinary `1`/`2`
/// rows, X is the index side (staged) and Y is the worktree side (unstaged);
/// in v2 the unchanged side is `.`, not space.
fn classify_xy(x: char, y: char) -> (String, String, FileStageState) {
    let staged = x != '.';
    let stage_state = FileStageState::from_xy(x, y);
    let kind_letter = if staged { x } else { y };
    let change_kind = match kind_letter {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' | 'C' => "renamed",
        _ => "modified",
    };
    (
        stage_state.legacy_status().to_string(),
        change_kind.to_string(),
        stage_state,
    )
}

/// Format reference for ordinary changed entries:
///   `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
/// Renamed/copied entries add a `<X><score>` field and a tab-separated
/// `<path>\t<orig_path>` tail:
///   `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<orig>`
/// So we skip 7 whitespace-separated tokens for kind=1 and 8 for kind=2,
/// then take the rest as the path (stopping at the tab for kind=2).
fn push_changed_entry(rest: &str, renamed: bool, out: &mut Vec<UncommittedFile>) {
    let mut chars = rest.chars();
    let x = chars.next().unwrap_or('.');
    let y = chars.next().unwrap_or('.');
    let (status, change_kind, stage_state) = classify_xy(x, y);
    let skip = if renamed { 8 } else { 7 };
    let Some(tail) = skip_fields(rest, skip) else {
        return;
    };
    let path = if renamed {
        // Renamed entries have `<new>\t<orig>`; we only surface `<new>`.
        tail.split('\t').next().unwrap_or("").to_string()
    } else {
        tail.to_string()
    };
    if path.is_empty() {
        return;
    }
    out.push(UncommittedFile {
        path,
        status,
        change_kind,
        additions: 0,
        deletions: 0,
        stage_state,
        conflict_kind: None,
    });
}

/// Skip `n` whitespace-separated fields and return the remainder of the
/// input (preserving any embedded `\t` so the rename split works). Returns
/// `None` if the input doesn't have at least `n` fields.
fn skip_fields(input: &str, n: usize) -> Option<&str> {
    let mut s = input;
    for _ in 0..n {
        let trimmed = s.trim_start();
        let end = trimmed.find(|c: char| c.is_whitespace())?;
        s = &trimmed[end..];
    }
    Some(s.trim_start())
}

/// Unmerged: `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`.
/// 10 fields before the path.
fn unmerged_path(rest: &str) -> Option<String> {
    let path = skip_fields(rest, 10)?.to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

fn parse_conflict_kind(rest: &str) -> Option<ConflictKind> {
    match rest.get(..2)? {
        "DD" => Some(ConflictKind::Dd),
        "AU" => Some(ConflictKind::Au),
        "UD" => Some(ConflictKind::Ud),
        "UA" => Some(ConflictKind::Ua),
        "DU" => Some(ConflictKind::Du),
        "AA" => Some(ConflictKind::Aa),
        "UU" => Some(ConflictKind::Uu),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_untracked_into_untracked_status() {
        let out = "? new.txt\n? sub/dir/other.md\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "new.txt");
        assert_eq!(files[0].status, "untracked");
        assert_eq!(files[0].change_kind, "untracked");
        assert_eq!(files[1].path, "sub/dir/other.md");
    }

    #[test]
    fn parses_staged_only_change() {
        let out = "1 M. N... 100644 100644 100644 abc def src/a.rs\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/a.rs");
        assert_eq!(files[0].status, "staged");
        assert_eq!(files[0].change_kind, "modified");
    }

    #[test]
    fn parses_unstaged_only_change() {
        let out = "1 .M N... 100644 100644 100644 abc def src/a.rs\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "unstaged");
        assert_eq!(files[0].change_kind, "modified");
    }

    #[test]
    fn parses_both_staged_and_unstaged_change() {
        let out = "1 MM N... 100644 100644 100644 abc def src/a.rs\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "both");
        assert_eq!(files[0].change_kind, "modified");
    }

    #[test]
    fn parses_added_and_deleted_change_kinds() {
        let out = "\
1 A. N... 000000 100644 100644 0000 abc new.rs
1 D. N... 100644 000000 100644 abc 0000 gone.rs
";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].change_kind, "added");
        assert_eq!(files[1].change_kind, "deleted");
    }

    #[test]
    fn parses_renamed_entry_picks_new_path() {
        let out = "2 R. N... 100644 100644 100644 abc def R100 newname.rs\toldname.rs\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "newname.rs");
        assert_eq!(files[0].status, "staged");
        assert_eq!(files[0].change_kind, "renamed");
    }

    #[test]
    fn parses_unmerged_entry_as_both() {
        let out = "u UU N... 100644 100644 100644 100644 a b c d conflict.rs\n";
        let files = parse_porcelain_v2_files(out);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "conflict.rs");
        assert_eq!(files[0].status, "both");
        assert_eq!(files[0].stage_state, FileStageState::Conflicted);
        assert_eq!(files[0].conflict_kind, Some(ConflictKind::Uu));
    }

    #[test]
    fn parses_every_canonical_conflict_kind() {
        for (xy, expected) in [
            ("DD", ConflictKind::Dd),
            ("AU", ConflictKind::Au),
            ("UD", ConflictKind::Ud),
            ("UA", ConflictKind::Ua),
            ("DU", ConflictKind::Du),
            ("AA", ConflictKind::Aa),
            ("UU", ConflictKind::Uu),
        ] {
            let out = format!("u {xy} N... 100644 100644 100644 100644 a b c d conflict-{xy}.rs\n");
            let files = parse_porcelain_v2_files(&out);
            assert_eq!(files[0].conflict_kind, Some(expected), "XY={xy}");
        }
    }

    // --- Real-git consistency tests ---
    // Run actual `git` against a tempdir so a future git release that tweaks
    // porcelain v2 (or our command-line glue) is caught here.

    use std::path::Path;
    use std::process::Command as ProcCommand;

    struct RealRepo {
        _tmp: tempfile::TempDir,
        path: std::path::PathBuf,
    }

    impl RealRepo {
        fn init() -> Self {
            let tmp = tempfile::tempdir().expect("tempdir");
            let path = tmp.path().to_path_buf();
            for cfg in [
                &["init", "-q", "-b", "main"][..],
                &["config", "user.email", "t@example.com"],
                &["config", "user.name", "T"],
                &["config", "commit.gpgsign", "false"],
                &["config", "tag.gpgsign", "false"],
            ] {
                run(&path, cfg);
            }
            Self { _tmp: tmp, path }
        }

        fn write(&self, rel: &str, contents: &[u8]) {
            let target = self.path.join(rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).expect("mkdir");
            }
            std::fs::write(&target, contents).expect("write");
        }

        fn git(&self, args: &[&str]) {
            run(&self.path, args);
        }

        fn porcelain(&self) -> String {
            let out = ProcCommand::new("git")
                .args(["status", "--porcelain=v2"])
                .current_dir(&self.path)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("HOME", &self.path)
                .output()
                .expect("git status spawn");
            assert!(
                out.status.success(),
                "git status failed: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).expect("non-utf8 porcelain")
        }
    }

    fn run(dir: &Path, args: &[&str]) {
        let out = ProcCommand::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "T")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "T")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .env("HOME", dir)
            .output()
            .expect("git spawn");
        assert!(
            out.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn find<'a>(files: &'a [UncommittedFile], path: &str) -> &'a UncommittedFile {
        files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("missing {path} in {files:?}"))
    }

    /// Seed a repo with an `a.txt` committed to HEAD. Lets each follow-up
    /// case start from a one-commit baseline without 4 lines of preamble.
    fn seeded_repo() -> RealRepo {
        let repo = RealRepo::init();
        repo.write("a.txt", b"v1\n");
        repo.git(&["add", "a.txt"]);
        repo.git(&["commit", "-q", "-m", "init"]);
        repo
    }

    #[test]
    fn real_git_staged_only_file() {
        let repo = seeded_repo();
        repo.write("a.txt", b"v2\n");
        repo.git(&["add", "a.txt"]);
        let f = find(&parse_porcelain_v2_files(&repo.porcelain()), "a.txt").clone();
        assert_eq!(f.status, "staged");
        assert_eq!(f.change_kind, "modified");
    }

    #[test]
    fn real_git_unstaged_only_file() {
        let repo = seeded_repo();
        repo.write("a.txt", b"v2\n");
        let f = find(&parse_porcelain_v2_files(&repo.porcelain()), "a.txt").clone();
        assert_eq!(f.status, "unstaged");
        assert_eq!(f.change_kind, "modified");
    }

    #[test]
    fn real_git_staged_and_unstaged_same_file_is_both() {
        let repo = seeded_repo();
        repo.write("a.txt", b"v2\n");
        repo.git(&["add", "a.txt"]);
        repo.write("a.txt", b"v3\n");
        let f = find(&parse_porcelain_v2_files(&repo.porcelain()), "a.txt").clone();
        assert_eq!(f.status, "both", "expected both, got: {f:?}");
    }

    #[test]
    fn real_git_untracked_file() {
        let repo = RealRepo::init();
        repo.write("seed.txt", b"seed\n");
        repo.git(&["add", "seed.txt"]);
        repo.git(&["commit", "-q", "-m", "seed"]);
        repo.write("new.txt", b"new\n");

        let files = parse_porcelain_v2_files(&repo.porcelain());
        let f = find(&files, "new.txt");
        assert_eq!(f.status, "untracked");
        assert_eq!(f.change_kind, "untracked");
    }

    #[test]
    fn real_git_deleted_file() {
        let repo = RealRepo::init();
        repo.write("gone.txt", b"bye\n");
        repo.git(&["add", "gone.txt"]);
        repo.git(&["commit", "-q", "-m", "init"]);
        std::fs::remove_file(repo.path.join("gone.txt")).unwrap();

        let files = parse_porcelain_v2_files(&repo.porcelain());
        let f = find(&files, "gone.txt");
        assert_eq!(f.change_kind, "deleted");
        // Worktree-only deletion (no `git rm`) shows up as unstaged.
        assert_eq!(f.status, "unstaged");
    }

    #[test]
    fn real_git_renamed_file_picks_new_path() {
        let repo = RealRepo::init();
        repo.write("old.txt", b"hello\n");
        repo.git(&["add", "old.txt"]);
        repo.git(&["commit", "-q", "-m", "init"]);
        repo.git(&["mv", "old.txt", "new.txt"]);

        let files = parse_porcelain_v2_files(&repo.porcelain());
        let f = find(&files, "new.txt");
        assert_eq!(f.change_kind, "renamed");
        assert_eq!(f.status, "staged");
    }

    #[test]
    fn real_git_binary_file_classified_as_added() {
        // Tiny PNG-like blob with embedded NULs. Numstat reports `-` for
        // binaries; this test only pins the porcelain row.
        let repo = RealRepo::init();
        let mut bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x00];
        bytes.extend_from_slice(&[0u8; 16]);
        repo.write("img.bin", &bytes);
        repo.git(&["add", "img.bin"]);

        let files = parse_porcelain_v2_files(&repo.porcelain());
        let f = find(&files, "img.bin");
        assert_eq!(f.status, "staged");
        assert_eq!(f.change_kind, "added");
    }
}

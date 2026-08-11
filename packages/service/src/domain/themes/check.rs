//! `cadencr-service check-theme <dir>` — the app's gate, on demand.
//!
//! A theme is edited by an agent that cannot see the theme library. Until this
//! existed the loop was open on the only end that mattered: the agent wrote
//! `theme.json`, the app validated it, and the verdict — the contrast failure,
//! the unparseable color, the missing texture file — appeared on a settings
//! card the agent has no way to read. It would then report the theme finished
//! while the app quietly refused to apply it.
//!
//! So the verdict is a command instead. Not a re-implementation of the rules:
//! this runs [`store::read_at`], which is the same function the gallery calls,
//! against the same folder the agent is working in. Whatever it says here is
//! exactly what the card says there — there is no second gate to drift.
//!
//! It needs no server, no database and no token, so it works while the app is
//! running, while it is not, and inside a packaged build.

use std::path::Path;

use super::store;

/// The check's verdict, ready to print. Separated from the printing so the
/// wording can be asserted in tests without capturing stdout.
pub struct Report {
    pub lines: Vec<String>,
    /// Whether the app would apply this theme.
    pub applicable: bool,
}

impl Report {
    pub fn text(&self) -> String {
        format!("{}\n", self.lines.join("\n"))
    }
}

/// Validate the theme in `dir`, exactly as the running app does.
pub async fn run(dir: &Path) -> Report {
    let theme = match store::read_at(dir).await {
        Ok(theme) => theme,
        // No `theme.json` here at all — almost always the command run from the
        // wrong directory, so say which one was looked at.
        Err(error) => {
            return Report {
                lines: vec![
                    format!("✗ {error}"),
                    String::new(),
                    format!("  Looked in {}", dir.display()),
                    "  Run this from the theme's own folder, or pass its path.".to_string(),
                ],
                applicable: false,
            }
        }
    };

    let name = theme.label.unwrap_or_else(|| theme.id.clone());
    if theme.issues.is_empty() {
        return Report {
            lines: vec![format!(
                "✓ {name} — valid. Nothing is holding this theme back."
            )],
            applicable: true,
        };
    }

    let count = theme.issues.len();
    let plural = if count == 1 { "problem" } else { "problems" };
    let mut lines = vec![
        format!("✗ {name} — {count} {plural}. The app will not apply this theme."),
        String::new(),
    ];
    lines.extend(
        theme
            .issues
            .iter()
            .map(|issue| format!("  {}", issue.describe())),
    );
    lines.push(String::new());
    lines.push("  See THEME.md in this folder for what each rule means.".to_string());
    Report {
        lines,
        applicable: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::themes::paths;
    use crate::domain::themes::test_support::{dracula_css_vars, dracula_xterm};
    use crate::domain::themes::{models::ThemeAppearance, store};

    async fn create(label: &str) -> std::path::PathBuf {
        let created = store::create()
            .label(label)
            .appearance(ThemeAppearance::Dark)
            .css_vars(dracula_css_vars())
            .xterm(dracula_xterm())
            .call()
            .await
            .expect("creates");
        paths::theme_dir(&created.id).expect("valid id")
    }

    /// Change exactly one token, the way an edit in the editor would.
    fn set_token(dir: &std::path::Path, token: &str, value: &str) {
        let file = dir.join(paths::THEME_FILE_NAME);
        let mut document: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).expect("read")).expect("parses");
        document["cssVars"][token] = serde_json::Value::String(value.to_string());
        std::fs::write(&file, document.to_string()).expect("write");
    }

    #[tokio::test]
    async fn a_good_theme_passes_and_says_so_by_name() {
        let dir = create("My Theme").await;
        let report = run(&dir).await;
        assert!(report.applicable);
        assert!(report.text().contains("✓ My Theme"), "{}", report.text());
    }

    /// The whole point: the message an agent reads has to be the message on the
    /// settings card, token and all.
    #[tokio::test]
    async fn a_failing_theme_reports_the_same_issues_the_gallery_shows() {
        let dir = create("My Theme").await;
        set_token(&dir, "--foreground", "#111111");

        let report = run(&dir).await;
        let text = report.text();

        assert!(!report.applicable);
        assert!(text.contains("1 problem."), "{text}");
        assert!(
            text.contains("--foreground: contrast against `--background`"),
            "{text}"
        );
        let gallery = store::read_at(&dir).await.expect("reads");
        assert!(text.contains(&gallery.issues[0].describe()));
    }

    #[tokio::test]
    async fn counts_more_than_one_problem_in_the_plural() {
        let dir = create("My Theme").await;
        let file = dir.join(paths::THEME_FILE_NAME);
        let broken = std::fs::read_to_string(&file)
            .expect("read")
            .replace("\"--ring\"", "\"--rung\"");
        std::fs::write(&file, broken).expect("write");

        let text = run(&dir).await.text();
        assert!(text.contains("2 problems."), "{text}");
        assert!(text.contains("--rung: unknown design token"), "{text}");
        assert!(text.contains("--ring: missing"), "{text}");
    }

    /// The likeliest way to run it wrong, so it has to be the clearest failure.
    #[tokio::test]
    async fn a_folder_with_no_theme_says_where_it_looked() {
        let dir = paths::themes_dir().join("not-a-theme");
        std::fs::create_dir_all(&dir).expect("creates");

        let report = run(&dir).await;
        let text = report.text();

        assert!(!report.applicable);
        assert!(text.contains("not found"), "{text}");
        assert!(text.contains("not-a-theme"), "{text}");
    }
}

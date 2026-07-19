//! Ranking heuristics for project icon discovery.
//!
//! Pure string scoring, deliberately free of any filesystem access so the scan
//! can rank every tracked image and only stat the handful it keeps.

use std::path::Path;

use super::icon_mime_for_path;

/// Filename stems that mark a file as a logo, strongest signal first.
const NAME_SIGNALS: &[(&str, i32)] = &[
    ("logo", 100),
    ("favicon", 80),
    ("app-icon", 80),
    ("appicon", 80),
    ("icon", 70),
    ("brand", 60),
    ("mark", 50),
    ("symbol", 40),
    ("avatar", 30),
];

/// Directories that conventionally hold brand assets. Slashes are baked in so
/// matching needs no per-path allocation.
const DIR_SIGNALS: &[(&str, &str, i32)] = &[
    ("public/", "/public/", 40),
    ("assets/", "/assets/", 35),
    ("static/", "/static/", 35),
    ("branding/", "/branding/", 45),
    ("brand/", "/brand/", 45),
    ("resources/", "/resources/", 25),
    (".github/", "/.github/", 30),
    ("docs/", "/docs/", 15),
    ("images/", "/images/", 20),
    ("img/", "/img/", 20),
    ("icons/", "/icons/", 35),
    ("media/", "/media/", 15),
];

/// Vendored and generated trees: never the project's own brand.
const VENDOR_DIRS: &[(&str, &str)] = &[
    ("node_modules/", "/node_modules/"),
    ("vendor/", "/vendor/"),
    ("target/", "/target/"),
    ("dist/", "/dist/"),
    ("build/", "/build/"),
    ("coverage/", "/coverage/"),
];

/// Formats that scale well as a small badge, preferred on ties.
fn format_bonus(path: &Path) -> i32 {
    match icon_mime_for_path(path) {
        Some("image/svg+xml") => 20,
        Some("image/png") => 12,
        Some("image/webp") => 8,
        Some("image/x-icon") => 6,
        _ => 0,
    }
}

/// Score a repo-relative path on how likely it is to be the project's logo.
pub(super) fn score_path(relative: &str) -> i32 {
    let path = Path::new(relative);
    let lower = relative.to_ascii_lowercase();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mut score = format_bonus(path);

    // Name signals: match on the stem so `logo.svg` outranks `blog-header.png`,
    // which merely contains "log".
    for (needle, weight) in NAME_SIGNALS {
        if stem.contains(needle) {
            score += weight;
            break;
        }
    }

    let depth = path.components().count();
    if depth == 1 {
        // A logo sitting at the repo root is almost always *the* logo.
        score += 50;
    } else {
        // Take the *strongest* matching directory, not the first one listed:
        // `branding/assets/logo.png` should score as branding (45), not assets
        // (35). Using `max` also decouples the result from array order.
        score += DIR_SIGNALS
            .iter()
            .filter(|(prefix, nested, _)| lower.starts_with(prefix) || lower.contains(nested))
            .map(|(_, _, weight)| *weight)
            .max()
            .unwrap_or(0);
        // Deeply nested assets are progressively less likely to be the brand mark.
        score -= ((depth as i32) - 2).max(0) * 6;
    }

    // Vendored and generated trees are noise, never the project's own brand.
    if VENDOR_DIRS
        .iter()
        .any(|(prefix, nested)| lower.starts_with(prefix) || lower.contains(nested))
    {
        score -= 120;
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_root_logo_above_nested_assets() {
        assert!(score_path("logo.svg") > score_path("src/components/assets/logo.png"));
    }

    #[test]
    fn ranks_named_logo_above_unrelated_image() {
        assert!(score_path("public/logo.svg") > score_path("public/hero-screenshot.png"));
    }

    #[test]
    fn ranks_favicon_above_generic_image() {
        assert!(score_path("public/favicon.ico") > score_path("public/banner.png"));
    }

    #[test]
    fn penalizes_vendored_trees() {
        assert!(score_path("logo.svg") > score_path("node_modules/pkg/logo.svg"));
        assert!(score_path("assets/logo.png") > score_path("dist/assets/logo.png"));
    }

    #[test]
    fn takes_the_strongest_matching_directory_not_the_first_listed() {
        // `branding` (45) outranks `assets` (35) even though `assets` is
        // listed earlier, so a path under both must score as branding.
        assert!(score_path("branding/assets/logo.png") > score_path("other/assets/logo.png"));
    }

    #[test]
    fn name_signal_matches_the_stem_not_the_whole_path() {
        // The stem carries the signal: `hero.png` earns nothing from sitting in
        // a directory whose name happens to contain "logo".
        assert!(score_path("weblogo/logo.png") > score_path("weblogo/hero.png"));
    }
}

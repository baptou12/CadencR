//! Data-driven LSP server catalog.
//!
//! Each `CatalogEntry` declares everything needed to find and invoke a
//! server: which LSP `languageId`s it serves, the binary name, the args,
//! the directories `cli-discovery` should walk, and (optionally) a GitHub
//! release template for the on-demand downloader (step 4).
//!
//! Adding a new language is a single static-table row — see
//! `.claude/rules/provider-boundaries.md`: no generic call site should
//! ever `match language_id { "rust" => …, "typescript" => … }`.

use cli_discovery::DiscoverySpec;

/// What a single LSP server looks like from the host's perspective.
#[derive(Debug)]
pub struct CatalogEntry {
    /// Stable, machine-friendly id used in `~/.cadencr/lsp/<lsp_id>/<version>/`
    /// and tracing. Independent of the binary name (the same id can stay
    /// stable even if upstream renames the binary).
    pub lsp_id: &'static str,
    /// LSP `TextDocumentItem` language ids served by this entry.
    pub language_ids: &'static [&'static str],
    /// Bare binary name on `$PATH`. Also doubles as the executable name
    /// inside the on-demand-download directory.
    pub bin_name: &'static str,
    /// Args appended to every invocation.
    pub args: &'static [&'static str],
    /// Directories relative to `$HOME` worth probing before falling back
    /// to the downloader (e.g. `.cargo/bin` for rust-analyzer).
    pub well_known_relative_to_home: &'static [&'static str],
    /// Absolute directories worth probing.
    pub well_known_absolute: &'static [&'static str],
    /// Args used to query the binary's version. `cli-discovery` parses
    /// the first semver triple out of the output.
    pub version_args: &'static [&'static str],
    /// When `Some(needle)`, candidates whose `--version` output doesn't
    /// contain `needle` (case-insensitive) are filtered out.
    ///
    /// Defends against version-multiplexer shims that masquerade as the
    /// requested binary — most notably `rust-analyzer` installed via
    /// `rustup`, where the proxy prints rustup's own help when the
    /// component isn't actually installed.
    pub version_must_contain: Option<&'static str>,
    /// Optional on-demand downloader recipe; `None` means "user must
    /// install this themselves".
    pub download: Option<DownloadRecipe>,
}

/// Recipe for downloading the server into
/// `~/.cadencr/lsp/<lsp_id>/<version>/`. Kept intentionally minimal — only
/// formats we actually need today. New shapes get a new variant rather
/// than a free-form scripting language.
#[derive(Debug, Clone)]
pub enum DownloadRecipe {
    /// Single executable hosted as a `.gz`-compressed GitHub release asset.
    /// `{arch}` / `{os}` / `{version}` are substituted into the URL template.
    GithubReleaseGz {
        /// Pinned version string used both as URL substitution and as the
        /// `<version>` directory under `~/.cadencr/lsp/<lsp_id>/`.
        version: &'static str,
        /// e.g. `https://github.com/rust-lang/rust-analyzer/releases/download/{version}/rust-analyzer-{arch}-{os}.gz`.
        url_template: &'static str,
    },
}

/// The static catalog. Order doesn't matter — lookup is by `language_id`.
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        lsp_id: "typescript-language-server",
        language_ids: &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        bin_name: "typescript-language-server",
        args: &["--stdio"],
        // Cover every reasonable place an npm-style global install ends up.
        // `Library/pnpm` is pnpm's `--global` target on macOS; `.cadencr-tools`
        // is where Cadencr writes its bundled install (see installer docs).
        well_known_relative_to_home: &[
            ".bun/bin",
            ".npm-global/bin",
            ".volta/bin",
            "Library/pnpm",
            ".cadencr-tools/node_modules/.bin",
        ],
        well_known_absolute: &["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["--version"],
        // tsserver's --version prints just `4.3.3` with no bin-name. The
        // shim guard would reject every install, so opt out.
        version_must_contain: None,
        // TS server is an npm package; downloader for it would need Node at
        // runtime, which we don't want to assume. Leave as `None` until we
        // ship a bundled Node sidecar.
        download: None,
    },
    CatalogEntry {
        lsp_id: "rust-analyzer",
        language_ids: &["rust"],
        bin_name: "rust-analyzer",
        args: &[],
        well_known_relative_to_home: &[".cargo/bin"],
        well_known_absolute: &["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["--version"],
        // `~/.cargo/bin/rust-analyzer` is often a rustup proxy hardlink. If
        // the `rust-analyzer` rustup component isn't installed, the proxy
        // prints rustup's help (and its own `1.28.x` version parses as a
        // valid semver), so we'd happily spawn rustup as an LSP. Require
        // the real binary's signature in the output instead — real
        // rust-analyzer prints e.g. `rust-analyzer 0.3.2050-standalone`.
        version_must_contain: Some("rust-analyzer"),
        download: Some(DownloadRecipe::GithubReleaseGz {
            // Pinned. Bump deliberately — surprise upgrades silently change
            // semantic analysis between Cadencr launches.
            version: "2025-05-19",
            url_template:
                "https://github.com/rust-lang/rust-analyzer/releases/download/{version}/rust-analyzer-{arch}-{os}.gz",
        }),
    },
    CatalogEntry {
        lsp_id: "gopls",
        language_ids: &["go"],
        bin_name: "gopls",
        args: &[],
        well_known_relative_to_home: &["go/bin"],
        well_known_absolute: &["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["version"],
        // `gopls version` prints `golang.org/x/tools/gopls v0.x.y` — bin
        // name appears, but we leave the guard off because gopls isn't
        // shimmed by another tool that masquerades as it.
        version_must_contain: None,
        download: None,
    },
    CatalogEntry {
        lsp_id: "pyright",
        language_ids: &["python"],
        bin_name: "pyright-langserver",
        args: &["--stdio"],
        well_known_relative_to_home: &[".bun/bin", ".npm-global/bin"],
        well_known_absolute: &["/opt/homebrew/bin", "/usr/local/bin"],
        version_args: &["--version"],
        version_must_contain: None,
        download: None,
    },
];

/// Look up the catalog entry serving a given LSP `languageId`.
pub fn lookup(language_id: &str) -> Option<&'static CatalogEntry> {
    CATALOG
        .iter()
        .find(|entry| entry.language_ids.contains(&language_id))
}

impl CatalogEntry {
    /// Build a `DiscoverySpec` that `cli-discovery` consumes.
    pub fn discovery_spec(&self) -> DiscoverySpec {
        DiscoverySpec {
            bin_name: self.bin_name,
            well_known_relative_to_home: self.well_known_relative_to_home.to_vec(),
            well_known_absolute: self.well_known_absolute.to_vec(),
            version_args: self.version_args,
            version_must_contain: self.version_must_contain,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_family_maps_to_tsserver() {
        let entry = lookup("typescript").expect("typescript");
        assert_eq!(entry.lsp_id, "typescript-language-server");
        assert!(entry.language_ids.contains(&"typescriptreact"));
    }

    #[test]
    fn rust_resolves_to_rust_analyzer() {
        let entry = lookup("rust").expect("rust");
        assert_eq!(entry.bin_name, "rust-analyzer");
        assert!(entry.download.is_some());
    }

    #[test]
    fn unknown_language_returns_none() {
        assert!(lookup("brainfuck").is_none());
    }

    #[test]
    fn no_duplicate_language_ids() {
        let mut seen = std::collections::HashSet::new();
        for entry in CATALOG {
            for lang in entry.language_ids {
                assert!(
                    seen.insert(*lang),
                    "language id {lang:?} appears in multiple catalog entries"
                );
            }
        }
    }

    #[test]
    fn rust_analyzer_has_rustup_shim_guard() {
        // Regression: without this filter, a rustup-proxied
        // `~/.cargo/bin/rust-analyzer` whose component isn't installed
        // shadows the managed install and every LSP request hangs.
        let entry = lookup("rust").expect("rust");
        assert_eq!(entry.version_must_contain, Some("rust-analyzer"));
    }

    #[test]
    fn no_duplicate_lsp_ids() {
        let mut seen = std::collections::HashSet::new();
        for entry in CATALOG {
            assert!(
                seen.insert(entry.lsp_id),
                "lsp_id {:?} appears twice in catalog",
                entry.lsp_id
            );
        }
    }
}

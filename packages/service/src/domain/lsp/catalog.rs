//! Data-driven LSP server catalog. Generic call sites should look up rows
//! here rather than branch on provider or language identity.

use cli_discovery::DiscoverySpec;

/// What a single LSP server looks like from the host's perspective.
#[derive(Debug)]
pub struct CatalogEntry {
    /// Stable id used in `~/.cadencr/lsp/<lsp_id>/<version>/` and tracing.
    pub lsp_id: &'static str,
    /// LSP `TextDocumentItem` language ids served by this entry.
    pub language_ids: &'static [&'static str],
    /// Bare binary name on `$PATH` or in a managed recipe.
    pub bin_name: &'static str,
    /// Args appended to every invocation.
    pub args: &'static [&'static str],
    /// Directories relative to `$HOME` worth probing.
    pub well_known_relative_to_home: &'static [&'static str],
    /// Absolute directories worth probing.
    pub well_known_absolute: &'static [&'static str],
    /// Args used to query the binary's version.
    pub version_args: &'static [&'static str],
    /// Optional case-insensitive substring required in `--version` output.
    pub version_must_contain: Option<&'static str>,
    /// Optional on-demand downloader recipe; `None` means "user must
    /// install this themselves".
    pub download: Option<DownloadRecipe>,
}

/// Recipe for installing the server into `~/.cadencr/lsp/<lsp_id>/<version>/`.
#[derive(Debug, Clone)]
pub enum DownloadRecipe {
    /// Single executable hosted as a `.gz` GitHub release asset.
    GithubReleaseGz {
        /// Pinned version string used for URL substitution and install dir.
        version: &'static str,
        /// URL template with `{version}`, `{arch}`, and `{os}` placeholders.
        url_template: &'static str,
        /// SHA-256 of the decompressed executable for each supported asset.
        sha256_by_platform: &'static [PlatformSha256],
    },
    /// npm packages installed into a managed local prefix.
    NpmPackage {
        /// Pinned recipe version used as the `<version>` install directory.
        version: &'static str,
        /// Exact package specs passed to `npm install`.
        packages: &'static [&'static str],
    },
}

impl DownloadRecipe {
    pub fn version(&self) -> &'static str {
        match self {
            DownloadRecipe::GithubReleaseGz { version, .. } => version,
            DownloadRecipe::NpmPackage { version, .. } => version,
        }
    }
}

pub(super) const NPM_WELL_KNOWN_RELATIVE_TO_HOME: &[&str] = &[
    ".bun/bin",
    ".npm-global/bin",
    ".volta/bin",
    "Library/pnpm",
    ".cadencr-tools/node_modules/.bin",
];
pub(super) const HOMEBREW_WELL_KNOWN_ABSOLUTE: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];

const fn npm_catalog_entry(
    lsp_id: &'static str,
    language_ids: &'static [&'static str],
    bin_name: &'static str,
    args: &'static [&'static str],
    version: &'static str,
    packages: &'static [&'static str],
) -> CatalogEntry {
    CatalogEntry {
        lsp_id,
        language_ids,
        bin_name,
        args,
        well_known_relative_to_home: NPM_WELL_KNOWN_RELATIVE_TO_HOME,
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
        version_args: &["--version"],
        version_must_contain: None,
        download: Some(DownloadRecipe::NpmPackage { version, packages }),
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlatformSha256 {
    pub arch: &'static str,
    pub os: &'static str,
    pub sha256: &'static str,
}

/// The static catalog. Order doesn't matter — lookup is by `language_id`.
pub const CATALOG: &[CatalogEntry] = &[
    npm_catalog_entry(
        "typescript-language-server",
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        "typescript-language-server",
        &["--stdio"],
        "5.3.0",
        &["typescript-language-server@5.3.0", "typescript@6.0.3"],
    ),
    npm_catalog_entry(
        "json-language-server",
        &["json", "jsonc"],
        "vscode-json-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "yaml-language-server",
        &["yaml"],
        "yaml-language-server",
        &["--stdio"],
        "1.23.0",
        &["yaml-language-server@1.23.0"],
    ),
    npm_catalog_entry(
        "html-language-server",
        &["html"],
        "vscode-html-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "css-language-server",
        &["css", "scss", "less"],
        "vscode-css-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "svelte-language-server",
        &["svelte"],
        "svelteserver",
        &["--stdio"],
        "0.18.0",
        &["svelte-language-server@0.18.0", "typescript@6.0.3"],
    ),
    npm_catalog_entry(
        "vue-language-server",
        &["vue"],
        "vue-language-server",
        &["--stdio"],
        "3.3.1",
        &["@vue/language-server@3.3.1", "typescript@6.0.3"],
    ),
    npm_catalog_entry(
        "astro-ls",
        &["astro"],
        "astro-ls",
        &["--stdio"],
        "2.16.9",
        &["@astrojs/language-server@2.16.9"],
    ),
    npm_catalog_entry(
        "bash-language-server",
        &["shellscript"],
        "bash-language-server",
        &["start"],
        "5.6.0",
        &["bash-language-server@5.6.0"],
    ),
    npm_catalog_entry(
        "docker-langserver",
        &["dockerfile"],
        "docker-langserver",
        &["--stdio"],
        "0.15.0",
        &["dockerfile-language-server-nodejs@0.15.0"],
    ),
    CatalogEntry {
        lsp_id: "rust-analyzer",
        language_ids: &["rust"],
        bin_name: "rust-analyzer",
        args: &[],
        well_known_relative_to_home: &[".cargo/bin"],
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
        version_args: &["--version"],
        // Reject rustup shims that don't have the component installed.
        version_must_contain: Some("rust-analyzer"),
        download: Some(DownloadRecipe::GithubReleaseGz {
            version: "2026-05-18",
            url_template:
                "https://github.com/rust-lang/rust-analyzer/releases/download/{version}/rust-analyzer-{arch}-{os}.gz",
            sha256_by_platform: &[
                PlatformSha256 {
                    arch: "x86_64",
                    os: "apple-darwin",
                    sha256: "7a302096e2d1a925172eae4bd948b4023d8add006f87bd8603afefd7703a9e41",
                },
                PlatformSha256 {
                    arch: "aarch64",
                    os: "apple-darwin",
                    sha256: "bdc9dea86392a14aa752de040e6e1b7b128d1021e6fdf688ded49164173985c6",
                },
                PlatformSha256 {
                    arch: "x86_64",
                    os: "unknown-linux-gnu",
                    sha256: "249f9b2b901cad51a0f62227eafbc02570a4230755fdb87a75b21dc8b0eaeafa",
                },
                PlatformSha256 {
                    arch: "aarch64",
                    os: "unknown-linux-gnu",
                    sha256: "e14f06cdb53678d245d714e92e749a9260482178738c7fb40f6aa6184f6220d0",
                },
            ],
        }),
    },
    CatalogEntry {
        lsp_id: "gopls",
        language_ids: &["go"],
        bin_name: "gopls",
        args: &[],
        well_known_relative_to_home: &["go/bin"],
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
        version_args: &["version"],
        version_must_contain: None,
        download: None,
    },
    CatalogEntry {
        lsp_id: "pyright",
        language_ids: &["python"],
        bin_name: "pyright-langserver",
        args: &["--stdio"],
        well_known_relative_to_home: NPM_WELL_KNOWN_RELATIVE_TO_HOME,
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
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
    fn typescript_language_server_has_managed_npm_recipe() {
        let entry = lookup("typescriptreact").expect("typescriptreact");
        let recipe = entry.download.as_ref().expect("managed installer");
        let DownloadRecipe::NpmPackage { version, packages } = recipe else {
            panic!("typescript-language-server should install through npm");
        };
        assert_eq!(*version, "5.3.0");
        assert_eq!(
            *packages,
            &["typescript-language-server@5.3.0", "typescript@6.0.3",]
        );
    }

    #[test]
    fn npm_managed_language_servers_are_registered() {
        let cases = [
            (
                "json",
                "json-language-server",
                "vscode-json-language-server",
            ),
            (
                "jsonc",
                "json-language-server",
                "vscode-json-language-server",
            ),
            ("yaml", "yaml-language-server", "yaml-language-server"),
            (
                "html",
                "html-language-server",
                "vscode-html-language-server",
            ),
            ("css", "css-language-server", "vscode-css-language-server"),
            ("scss", "css-language-server", "vscode-css-language-server"),
            ("less", "css-language-server", "vscode-css-language-server"),
            ("svelte", "svelte-language-server", "svelteserver"),
            ("vue", "vue-language-server", "vue-language-server"),
            ("astro", "astro-ls", "astro-ls"),
            (
                "shellscript",
                "bash-language-server",
                "bash-language-server",
            ),
            ("dockerfile", "docker-langserver", "docker-langserver"),
        ];

        for (language_id, lsp_id, bin_name) in cases {
            let entry = lookup(language_id).expect(language_id);
            assert_eq!(entry.lsp_id, lsp_id);
            assert_eq!(entry.bin_name, bin_name);
            assert!(
                matches!(entry.download, Some(DownloadRecipe::NpmPackage { .. })),
                "{lsp_id} should install through npm"
            );
        }
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

//! Data-driven LSP server catalog. Generic call sites should look up rows
//! here rather than branch on provider or language identity.

mod entries;
mod types;

pub use entries::CATALOG;
pub(super) use entries::{HOMEBREW_WELL_KNOWN_ABSOLUTE, NPM_WELL_KNOWN_RELATIVE_TO_HOME};
pub use types::{CatalogEntry, DownloadRecipe, PlatformSha256, ServerRole};

/// Look up the *default* catalog entry serving a given LSP `languageId`.
///
/// "Default" = the language's primary intelligence server: the first
/// non-Linter entry (TypeChecker / General), so callers that don't specify a
/// concrete `lsp_id` get type-checking, not a linter. Used by the
/// language-id-only session path and root resolution.
pub fn lookup(language_id: &str) -> Option<&'static CatalogEntry> {
    let all = lookup_all(language_id);
    all.iter()
        .find(|entry| entry.role != ServerRole::Linter)
        .or_else(|| all.first())
        .copied()
}

/// Every catalog entry serving a given LSP `languageId`, in catalog order.
/// The frontend's `active-servers` picks one TypeChecker plus an optional
/// Linter from this set based on per-project settings.
pub fn lookup_all(language_id: &str) -> Vec<&'static CatalogEntry> {
    CATALOG
        .iter()
        .filter(|entry| entry.language_ids.contains(&language_id))
        .collect()
}

/// Look up a catalog entry by its stable `lsp_id`. Used by the session and
/// root endpoints when the renderer asks for a specific server.
pub fn lookup_by_id(lsp_id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|entry| entry.lsp_id == lsp_id)
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
    fn no_duplicate_language_id_per_server() {
        // The Phase-4 model: a language is served by several *alternative*
        // entries the user selects between (one type checker + one linter), so
        // the old "one entry per language" invariant is gone. What must still
        // hold is that a single server never lists the same language twice and
        // that every (lsp_id, language_id) pair is unique across the catalog —
        // otherwise selection by id+language would be ambiguous.
        let mut seen = std::collections::HashSet::new();
        for entry in CATALOG {
            for lang in entry.language_ids {
                assert!(
                    seen.insert((entry.lsp_id, *lang)),
                    "(lsp_id {:?}, language id {lang:?}) appears more than once",
                    entry.lsp_id
                );
            }
        }
    }

    #[test]
    fn type_checkers_are_selectable_alternatives_for_ts() {
        // tsgo and typescript-language-server intentionally share role + langs:
        // they're alternatives chosen via `editor_typescript_server`. Confirm
        // both exist as TypeCheckers for typescript so selection has options.
        let ts_checkers: Vec<&str> = lookup_all("typescript")
            .iter()
            .filter(|e| e.role == ServerRole::TypeChecker)
            .map(|e| e.lsp_id)
            .collect();
        assert!(ts_checkers.contains(&"typescript-language-server"));
        assert!(ts_checkers.contains(&"tsgo"));
    }

    #[test]
    fn lookup_skips_linters_for_default() {
        // The default (`lookup`) for a TS file must be the type checker, never
        // a linter, even though several linters also serve TS.
        let entry = lookup("typescript").expect("typescript");
        assert_eq!(entry.role, ServerRole::TypeChecker);
        assert_eq!(entry.lsp_id, "typescript-language-server");
    }

    #[test]
    fn lookup_all_returns_every_server_for_language() {
        let ids: Vec<&str> = lookup_all("typescript").iter().map(|e| e.lsp_id).collect();
        for expected in [
            "typescript-language-server",
            "tsgo",
            "biome",
            "eslint",
            "oxlint",
        ] {
            assert!(
                ids.contains(&expected),
                "lookup_all(typescript) missing {expected}; got {ids:?}"
            );
        }
    }

    #[test]
    fn lookup_by_id_resolves_concrete_servers() {
        assert_eq!(lookup_by_id("tsgo").expect("tsgo").bin_name, "tsgo");
        assert_eq!(
            lookup_by_id("biome").expect("biome").role,
            ServerRole::Linter
        );
        assert!(lookup_by_id("does-not-exist").is_none());
    }

    #[test]
    fn new_servers_have_managed_npm_recipes() {
        for id in ["tsgo", "biome", "eslint", "oxlint"] {
            let entry = lookup_by_id(id).expect(id);
            assert!(
                matches!(entry.download, Some(DownloadRecipe::NpmPackage { .. })),
                "{id} should install through npm"
            );
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
    fn typescript_family_roots_at_tsconfig_first() {
        let entry = lookup("typescript").expect("typescript");
        assert_eq!(
            entry.root_markers,
            &["tsconfig.json", "jsconfig.json", "package.json"]
        );
    }

    #[test]
    fn rust_roots_at_cargo_toml() {
        let entry = lookup("rust").expect("rust");
        assert_eq!(entry.root_markers, &["Cargo.toml"]);
    }

    #[test]
    fn config_languages_have_no_root_markers() {
        for lang in ["json", "yaml", "css", "html"] {
            let entry = lookup(lang).expect(lang);
            assert!(
                entry.root_markers.is_empty(),
                "{lang} should fall back to the feature root"
            );
        }
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

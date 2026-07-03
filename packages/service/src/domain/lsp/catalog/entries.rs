use super::{CatalogEntry, DownloadRecipe, PlatformSha256, ServerRole};

pub(in crate::domain::lsp) const NPM_WELL_KNOWN_RELATIVE_TO_HOME: &[&str] = &[
    ".bun/bin",
    ".npm-global/bin",
    ".volta/bin",
    "Library/pnpm",
    ".cadencr-tools/node_modules/.bin",
];
pub(in crate::domain::lsp) const HOMEBREW_WELL_KNOWN_ABSOLUTE: &[&str] =
    &["/opt/homebrew/bin", "/usr/local/bin"];

/// Root markers for the JS/TS family (and TS-backed frameworks). Prefer the
/// most specific config first so a nested package roots there rather than at
/// the monorepo's top-level `package.json`.
const JS_TS_ROOT_MARKERS: &[&str] = &["tsconfig.json", "jsconfig.json", "package.json"];

/// Config-file language servers (json/yaml/html/css/shell/docker) have no
/// meaningful per-package root — they reason about a single file — so they
/// fall back to the feature working dir.
const NO_ROOT_MARKERS: &[&str] = &[];

#[allow(clippy::too_many_arguments)]
const fn npm_catalog_entry(
    lsp_id: &'static str,
    role: ServerRole,
    language_ids: &'static [&'static str],
    root_markers: &'static [&'static str],
    bin_name: &'static str,
    args: &'static [&'static str],
    version: &'static str,
    packages: &'static [&'static str],
) -> CatalogEntry {
    CatalogEntry {
        lsp_id,
        role,
        language_ids,
        root_markers,
        bin_name,
        args,
        well_known_relative_to_home: NPM_WELL_KNOWN_RELATIVE_TO_HOME,
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
        version_args: &["--version"],
        version_must_contain: None,
        download: Some(DownloadRecipe::NpmPackage { version, packages }),
    }
}

/// The static catalog. Order doesn't matter — lookup is by `language_id`.
pub const CATALOG: &[CatalogEntry] = &[
    npm_catalog_entry(
        "typescript-language-server",
        ServerRole::TypeChecker,
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        JS_TS_ROOT_MARKERS,
        "typescript-language-server",
        &["--stdio"],
        "5.3.0",
        &["typescript-language-server@5.3.0", "typescript@6.0.3"],
    ),
    // `tsgo`, the Go-native TypeScript compiler's language server. Same TS
    // family as `typescript-language-server` but role-distinct, so both can
    // coexist in the catalog (selection picks one via `editor_typescript_server`).
    // native-preview exposes the LSP over stdio with `tsgo --lsp -stdio`.
    npm_catalog_entry(
        "tsgo",
        ServerRole::TypeChecker,
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        JS_TS_ROOT_MARKERS,
        "tsgo",
        &["--lsp", "-stdio"],
        "7.0.0-dev.20250609.1",
        &["@typescript/native-preview@7.0.0-dev.20250609.1"],
    ),
    // Biome: linter + formatter for the JS/TS/JSON family. `biome lsp-proxy`
    // speaks LSP over stdio. Role Linter (it also formats, surfaced through
    // the formatter catalog rather than a second LSP entry).
    npm_catalog_entry(
        "biome",
        ServerRole::Linter,
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
            "json",
            "jsonc",
        ],
        JS_TS_ROOT_MARKERS,
        "biome",
        &["lsp-proxy"],
        "1.9.4",
        &["@biomejs/biome@1.9.4"],
    ),
    // ESLint language server. Flat-config (`eslint.config.js`) is auto-detected
    // by recent versions; legacy `.eslintrc*` still works. Role Linter.
    npm_catalog_entry(
        "eslint",
        ServerRole::Linter,
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        JS_TS_ROOT_MARKERS,
        "vscode-eslint-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    // oxlint's language server (`oxc_language_server`). Role Linter.
    npm_catalog_entry(
        "oxlint",
        ServerRole::Linter,
        &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
        JS_TS_ROOT_MARKERS,
        "oxc_language_server",
        &[],
        "0.16.0",
        &["oxlint@0.16.0"],
    ),
    npm_catalog_entry(
        "json-language-server",
        ServerRole::General,
        &["json", "jsonc"],
        NO_ROOT_MARKERS,
        "vscode-json-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "yaml-language-server",
        ServerRole::General,
        &["yaml"],
        NO_ROOT_MARKERS,
        "yaml-language-server",
        &["--stdio"],
        "1.23.0",
        &["yaml-language-server@1.23.0"],
    ),
    npm_catalog_entry(
        "html-language-server",
        ServerRole::General,
        &["html"],
        NO_ROOT_MARKERS,
        "vscode-html-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "css-language-server",
        ServerRole::General,
        &["css", "scss", "less"],
        NO_ROOT_MARKERS,
        "vscode-css-language-server",
        &["--stdio"],
        "4.10.0",
        &["vscode-langservers-extracted@4.10.0"],
    ),
    npm_catalog_entry(
        "svelte-language-server",
        ServerRole::TypeChecker,
        &["svelte"],
        JS_TS_ROOT_MARKERS,
        "svelteserver",
        &["--stdio"],
        "0.18.0",
        &["svelte-language-server@0.18.0", "typescript@6.0.3"],
    ),
    npm_catalog_entry(
        "vue-language-server",
        ServerRole::TypeChecker,
        &["vue"],
        JS_TS_ROOT_MARKERS,
        "vue-language-server",
        &["--stdio"],
        "3.3.1",
        &["@vue/language-server@3.3.1", "typescript@6.0.3"],
    ),
    npm_catalog_entry(
        "astro-ls",
        ServerRole::TypeChecker,
        &["astro"],
        JS_TS_ROOT_MARKERS,
        "astro-ls",
        &["--stdio"],
        "2.16.9",
        &["@astrojs/language-server@2.16.9"],
    ),
    npm_catalog_entry(
        "bash-language-server",
        ServerRole::General,
        &["shellscript"],
        NO_ROOT_MARKERS,
        "bash-language-server",
        &["start"],
        "5.6.0",
        &["bash-language-server@5.6.0"],
    ),
    npm_catalog_entry(
        "docker-langserver",
        ServerRole::General,
        &["dockerfile"],
        NO_ROOT_MARKERS,
        "docker-langserver",
        &["--stdio"],
        "0.15.0",
        &["dockerfile-language-server-nodejs@0.15.0"],
    ),
    CatalogEntry {
        lsp_id: "rust-analyzer",
        role: ServerRole::TypeChecker,
        language_ids: &["rust"],
        // rust-analyzer already roots at the cargo workspace itself, so this
        // marker only ensures we hand it the crate/workspace dir rather than
        // a feature root that might sit above multiple unrelated crates.
        root_markers: &["Cargo.toml"],
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
        role: ServerRole::TypeChecker,
        language_ids: &["go"],
        root_markers: &["go.work", "go.mod"],
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
        role: ServerRole::TypeChecker,
        language_ids: &["python"],
        root_markers: &["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
        bin_name: "pyright-langserver",
        args: &["--stdio"],
        well_known_relative_to_home: NPM_WELL_KNOWN_RELATIVE_TO_HOME,
        well_known_absolute: HOMEBREW_WELL_KNOWN_ABSOLUTE,
        version_args: &["--version"],
        version_must_contain: None,
        download: None,
    },
];

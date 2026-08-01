use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Light/dark classification. Drives `color-scheme`, the logo variant and the
/// editor's built-in fallback styling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ThemeAppearance {
    Light,
    Dark,
}

/// The xterm.js palette. Terminals are canvas-rendered and can't read CSS
/// variables, so every theme carries the palette explicitly.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct XtermPalette {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub cursor_accent: String,
    pub selection_background: String,
    pub selection_foreground: String,
    pub selection_inactive_background: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

/// A user theme exactly as it is stored in `~/.cadencr/themes/<id>/theme.json`.
///
/// This is the whole extensibility surface of step 1: pure data, no behavior.
/// `css_vars` is a closed set of known design tokens (see `tokens.rs`) whose
/// values must parse as CSS colors — a theme can never introduce arbitrary CSS.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDocument {
    pub label: String,
    pub appearance: ThemeAppearance,
    /// `--token` → CSS color value. Ordered so a round-trip through the editor
    /// doesn't reshuffle the file.
    pub css_vars: BTreeMap<String, String>,
    pub xterm: XtermPalette,
}

/// Why a theme can't be applied. Every issue is surfaced in the gallery; a
/// theme with any issue is never registered as applicable.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ThemeIssue {
    /// The offending token (`--background`), or `None` for document-level
    /// problems such as invalid JSON.
    pub token: Option<String>,
    pub message: String,
}

impl ThemeIssue {
    pub fn new(token: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            token: Some(token.into()),
            message: message.into(),
        }
    }

    /// A problem with the file as a whole rather than one token.
    pub fn document(message: impl Into<String>) -> Self {
        Self {
            token: None,
            message: message.into(),
        }
    }

    /// `--token: message`, or just the message for a document-level issue.
    pub fn describe(&self) -> String {
        match &self.token {
            Some(token) => format!("{token}: {}", self.message),
            None => self.message.clone(),
        }
    }
}

/// One entry in the theme gallery.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UserTheme {
    /// Directory slug under `~/.cadencr/themes/`. The renderer applies it as
    /// `user:<id>`.
    pub id: String,
    /// Absolute path to `theme.json`, so the gallery can show and copy it.
    pub path: String,
    /// Raw file text, for the JSON editor and for export-to-file.
    pub content: String,
    /// The document's declared name, kept even when validation failed so the
    /// gallery can say *which* theme broke. `None` only when the file isn't
    /// parseable JSON at all.
    pub label: Option<String>,
    /// `None` when the document failed validation — the theme is listed and its
    /// issues shown, but it is never applied.
    pub theme: Option<ThemeDocument>,
    pub issues: Vec<ThemeIssue>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateThemeRequest {
    /// Human-readable name; the on-disk id is slugified from it.
    pub label: String,
    pub appearance: ThemeAppearance,
    pub css_vars: BTreeMap<String, String>,
    pub xterm: XtermPalette,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct WriteThemeRequest {
    pub content: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WriteThemeResponse {
    pub theme: UserTheme,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeleteThemeResponse {
    pub success: bool,
}

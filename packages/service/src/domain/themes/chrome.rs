//! The non-color half of a theme: how the app's chassis, tabs and background
//! *texture* are shaped.
//!
//! `css_vars` answers "what color is this"; chrome answers the three questions
//! that used to be answered by hardcoding a theme id in a stylesheet — whether
//! the page tucks into the sidebar rail, whether pane tabs are a segmented
//! control or an underline, and what (if anything) drifts behind the app. A
//! theme duplicated from CadencR Dark or Frost now carries those traits with it
//! instead of losing them at the door.
//!
//! Like the token set, this is a *closed* vocabulary: enums and bounded
//! numbers, never CSS text. The one open value is an image asset, which is a
//! file in the theme's own folder — read and inlined by the backend, never a
//! URL the theme gets to name.
//!
//! Every struct here denies unknown fields. Chrome is the one part of the
//! document that is *defaulted*, so serde's usual leniency would turn a
//! misspelled key into a silent no-op: the theme keeps loading, quietly flat,
//! and nothing anywhere says why. Whoever is editing the file — usually an agent
//! that has only the file to go on — has to be told. See `schema.rs` and the
//! `THEME.md` written beside it for the other half of that answer.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::color::parse_color;
use super::models::ThemeIssue;
use super::validate::MAX_VALUE_LEN;

/// How the page meets the sidebar.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeChassis {
    /// The page is a plain full-bleed surface under its own header.
    #[default]
    Flat,
    /// Sidebar and page header share one continuous rail; the content below
    /// tucks into it as a raised page with a rounded top-left corner.
    Rail,
}

impl ThemeChassis {
    /// Every value. The JSON Schema and `THEME.md` are both generated from these
    /// lists, so a new variant reaches whoever is editing a theme file without a
    /// second edit — extend the list when you add one.
    pub const ALL: &'static [Self] = &[Self::Flat, Self::Rail];
}

/// How the active pane tab is drawn.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeTabs {
    /// A hairline indicator under the active tab.
    #[default]
    Underline,
    /// A recessed track holding a raised pill for the active tab.
    Segmented,
}

impl ThemeTabs {
    /// See [`ThemeChassis::ALL`].
    pub const ALL: &'static [Self] = &[Self::Underline, Self::Segmented];
}

/// How a texture layer composites over what is behind it. The CSS
/// `mix-blend-mode` values that are useful for a background wash.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeBlend {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    SoftLight,
    HardLight,
    Difference,
    Luminosity,
}

impl ThemeBlend {
    /// See [`ThemeChassis::ALL`].
    pub const ALL: &'static [Self] = &[
        Self::Normal,
        Self::Multiply,
        Self::Screen,
        Self::Overlay,
        Self::SoftLight,
        Self::HardLight,
        Self::Difference,
        Self::Luminosity,
    ];
}

/// How an image texture fills the window.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeImageFit {
    /// Repeated at `scale` px — the right choice for a seamless noise or paper.
    #[default]
    Tile,
    /// Scaled to cover the window, cropping the overflow.
    Cover,
    /// Scaled to fit inside the window.
    Contain,
}

impl ThemeImageFit {
    /// See [`ThemeChassis::ALL`].
    pub const ALL: &'static [Self] = &[Self::Tile, Self::Cover, Self::Contain];
}

/// One drifting, heavily-blurred field of color.
///
/// Position is the halo's *center*, as a percentage of the viewport, so a
/// texture reads the same on any window shape. `size` is a diameter in `vw`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeHalo {
    pub color: String,
    /// Diameter, in `vw`.
    pub size: f32,
    /// Center, as a percentage of viewport width.
    pub x: f32,
    /// Center, as a percentage of viewport height.
    pub y: f32,
    /// Gaussian blur radius, in px.
    pub blur: f32,
    pub opacity: f32,
    /// Seconds for one drift cycle. `0` holds the halo still.
    pub drift: f32,
}

/// Fine noise laid over the field. The speckle itself is generated; a theme
/// picks its color, strength, tile size and how it composites.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeGrain {
    pub color: String,
    pub opacity: f32,
    pub blend: ThemeBlend,
    /// Tile size in px. Smaller reads as finer grain.
    pub scale: f32,
}

/// An image from the theme's own folder, laid over the field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeImage {
    /// File name inside the theme directory — `paper.png`, never a path or URL.
    pub asset: String,
    pub opacity: f32,
    pub blend: ThemeBlend,
    pub fit: ThemeImageFit,
    /// Tile size in px. Ignored unless `fit` is `tile`.
    pub scale: f32,
}

/// Everything painted behind the app, bottom to top: a flat base, drifting
/// halos, an image, grain, then an optional veil that dims the lot back down so
/// the UI on top stays readable.
///
/// The default is empty — no layers, nothing rendered, nothing to pay for.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ThemeTexture {
    /// Flat color behind every layer. `None` leaves the page background alone.
    pub base: Option<String>,
    pub halos: Vec<ThemeHalo>,
    pub image: Option<ThemeImage>,
    pub grain: Option<ThemeGrain>,
    /// Wash the finished field with the page background, so surfaces above it
    /// keep their contrast. This is what keeps a lively texture legible.
    pub veil: bool,
}

/// The shape of a theme, as opposed to its palette.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ThemeChrome {
    pub chassis: ThemeChassis,
    pub tabs: ThemeTabs,
    pub texture: ThemeTexture,
}

/// Halos are cheap individually and ruinous in bulk — each one is a full-screen
/// blurred layer the compositor repaints.
pub const MAX_HALOS: usize = 8;
pub const MAX_ASSET_NAME_LEN: usize = 64;
/// Extensions that a browser will actually paint as a `background-image`.
pub const ASSET_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];

/// The bounds every number in a texture has to sit inside.
///
/// Public and named because they are asserted in two places that must agree: the
/// validator below, which decides whether a theme can be applied, and the JSON
/// Schema written into the theme folder, which is what tells the editor — and
/// the agent — the range *before* the value is saved. A range that drifted
/// between the two would mean the file's own schema calls a value legal and the
/// app then refuses to paint it.
pub type Range = (f32, f32);

pub const HALO_SIZE: Range = (1.0, 400.0);
/// Halo centers may sit off-screen, which is how a field is anchored to an edge.
pub const HALO_OFFSET: Range = (-200.0, 200.0);
pub const HALO_BLUR: Range = (0.0, 400.0);
pub const HALO_DRIFT: Range = (0.0, 600.0);
pub const OPACITY: Range = (0.0, 1.0);
pub const GRAIN_SCALE: Range = (4.0, 2048.0);
pub const IMAGE_SCALE: Range = (4.0, 4096.0);

pub fn validate(chrome: &ThemeChrome) -> Vec<ThemeIssue> {
    let texture = &chrome.texture;
    let mut issues = Vec::new();

    if let Some(base) = &texture.base {
        check_color("chrome.texture.base", base, &mut issues);
    }
    if texture.halos.len() > MAX_HALOS {
        issues.push(ThemeIssue::new(
            "chrome.texture.halos",
            format!("at most {MAX_HALOS} halos — each one is a full-screen blurred layer"),
        ));
    }
    for (index, halo) in texture.halos.iter().enumerate() {
        validate_halo(index, halo, &mut issues);
    }
    if let Some(grain) = &texture.grain {
        check_color("chrome.texture.grain.color", &grain.color, &mut issues);
        check_range(
            "chrome.texture.grain.opacity",
            grain.opacity,
            OPACITY,
            &mut issues,
        );
        check_range(
            "chrome.texture.grain.scale",
            grain.scale,
            GRAIN_SCALE,
            &mut issues,
        );
    }
    if let Some(image) = &texture.image {
        validate_asset_name(&image.asset, &mut issues);
        check_range(
            "chrome.texture.image.opacity",
            image.opacity,
            OPACITY,
            &mut issues,
        );
        check_range(
            "chrome.texture.image.scale",
            image.scale,
            IMAGE_SCALE,
            &mut issues,
        );
    }
    issues
}

fn validate_halo(index: usize, halo: &ThemeHalo, issues: &mut Vec<ThemeIssue>) {
    let at = |field: &str| format!("chrome.texture.halos[{index}].{field}");
    check_color(&at("color"), &halo.color, issues);
    check_range(&at("size"), halo.size, HALO_SIZE, issues);
    check_range(&at("x"), halo.x, HALO_OFFSET, issues);
    check_range(&at("y"), halo.y, HALO_OFFSET, issues);
    check_range(&at("blur"), halo.blur, HALO_BLUR, issues);
    check_range(&at("opacity"), halo.opacity, OPACITY, issues);
    check_range(&at("drift"), halo.drift, HALO_DRIFT, issues);
}

/// An asset is a plain file name in the theme's own folder. Anything that could
/// name a file outside it — a separator, a `..`, a scheme — is not a name.
fn validate_asset_name(asset: &str, issues: &mut Vec<ThemeIssue>) {
    let field = "chrome.texture.image.asset";
    if asset.is_empty() || asset.len() > MAX_ASSET_NAME_LEN {
        issues.push(ThemeIssue::new(
            field,
            format!("must be a file name of 1 to {MAX_ASSET_NAME_LEN} characters"),
        ));
        return;
    }
    let plain = asset
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !plain || asset.starts_with('.') || asset.contains("..") {
        issues.push(ThemeIssue::new(
            field,
            "must be a plain file name in the theme's own folder (letters, digits, `.`, `_`, `-`)",
        ));
        return;
    }
    if asset_extension(asset).is_none() {
        issues.push(ThemeIssue::new(
            field,
            format!("must be one of: {}", ASSET_EXTENSIONS.join(", ")),
        ));
    }
}

/// The lowercased extension of an asset name, when it is one we can paint.
pub fn asset_extension(asset: &str) -> Option<&'static str> {
    let extension = asset.rsplit_once('.')?.1.to_ascii_lowercase();
    ASSET_EXTENSIONS
        .iter()
        .find(|known| **known == extension)
        .copied()
}

/// The same gate `css_vars` values pass, cap included — a color is a color
/// wherever it is written, and a texture layer has no more business carrying a
/// kilobyte of string than a token does.
fn check_color(field: &str, value: &str, issues: &mut Vec<ThemeIssue>) {
    if value.len() > MAX_VALUE_LEN {
        issues.push(ThemeIssue::new(
            field,
            format!("value must be at most {MAX_VALUE_LEN} characters"),
        ));
        return;
    }
    if let Err(error) = parse_color(value) {
        issues.push(ThemeIssue::new(field, error.to_string()));
    }
}

fn check_range(field: &str, value: f32, (min, max): Range, issues: &mut Vec<ThemeIssue>) {
    if !value.is_finite() || value < min || value > max {
        issues.push(ThemeIssue::new(
            field,
            format!("must be between {min} and {max}"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn halo() -> ThemeHalo {
        ThemeHalo {
            color: "#ffffff".into(),
            size: 72.0,
            x: 28.0,
            y: 32.0,
            blur: 80.0,
            opacity: 0.5,
            drift: 28.0,
        }
    }

    fn messages(chrome: &ThemeChrome) -> Vec<String> {
        validate(chrome).iter().map(ThemeIssue::describe).collect()
    }

    #[test]
    fn the_default_chrome_is_empty_and_valid() {
        let chrome = ThemeChrome::default();
        assert_eq!(chrome.chassis, ThemeChassis::Flat);
        assert_eq!(chrome.tabs, ThemeTabs::Underline);
        assert_eq!(chrome.texture, ThemeTexture::default());
        assert!(validate(&chrome).is_empty());
    }

    #[test]
    fn accepts_a_full_texture() {
        let chrome = ThemeChrome {
            chassis: ThemeChassis::Rail,
            tabs: ThemeTabs::Segmented,
            texture: ThemeTexture {
                base: Some("oklch(0.165 0.018 262)".into()),
                halos: vec![halo(), halo()],
                image: Some(ThemeImage {
                    asset: "paper.png".into(),
                    opacity: 0.2,
                    blend: ThemeBlend::Multiply,
                    fit: ThemeImageFit::Tile,
                    scale: 320.0,
                }),
                grain: Some(ThemeGrain {
                    color: "#9ea8c7".into(),
                    opacity: 0.36,
                    blend: ThemeBlend::Screen,
                    scale: 180.0,
                }),
                veil: true,
            },
        };
        assert_eq!(messages(&chrome), Vec::<String>::new());
    }

    #[test]
    fn rejects_an_unparseable_color() {
        let chrome = ThemeChrome {
            texture: ThemeTexture {
                base: Some("not-a-color".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(messages(&chrome)
            .iter()
            .any(|m| m.starts_with("chrome.texture.base")));
    }

    #[test]
    fn caps_a_chrome_color_at_the_same_length_a_token_value_gets() {
        // Without this the texture is the one place a theme can carry an
        // unbounded string: `css_vars` values are capped, and a color that long
        // is never a color anyway.
        let chrome = ThemeChrome {
            texture: ThemeTexture {
                base: Some("#".to_string() + &"0".repeat(MAX_VALUE_LEN)),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(messages(&chrome)
            .iter()
            .any(|m| m.contains("at most") && m.contains("characters")));
    }

    #[test]
    fn rejects_out_of_range_numbers_naming_the_offending_halo() {
        let chrome = ThemeChrome {
            texture: ThemeTexture {
                halos: vec![
                    halo(),
                    ThemeHalo {
                        opacity: 4.0,
                        ..halo()
                    },
                ],
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(
            messages(&chrome)
                .iter()
                .any(|m| m.starts_with("chrome.texture.halos[1].opacity")),
            "{:?}",
            messages(&chrome)
        );
    }

    #[test]
    fn rejects_more_halos_than_the_compositor_should_carry() {
        let chrome = ThemeChrome {
            texture: ThemeTexture {
                halos: vec![halo(); MAX_HALOS + 1],
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(messages(&chrome)
            .iter()
            .any(|m| m.contains("at most 8 halos")));
    }

    #[test]
    fn rejects_an_asset_that_could_name_a_file_outside_the_theme() {
        for asset in [
            "../../.ssh/id_rsa.png",
            "sub/dir.png",
            ".hidden.png",
            "https://example.com/x.png",
            "notes.txt",
            "",
        ] {
            let chrome = ThemeChrome {
                texture: ThemeTexture {
                    image: Some(ThemeImage {
                        asset: asset.into(),
                        opacity: 0.2,
                        blend: ThemeBlend::Normal,
                        fit: ThemeImageFit::Tile,
                        scale: 320.0,
                    }),
                    ..Default::default()
                },
                ..Default::default()
            };
            assert!(
                messages(&chrome)
                    .iter()
                    .any(|m| m.starts_with("chrome.texture.image.asset")),
                "{asset:?} must be rejected"
            );
        }
    }

    /// The failure mode this exists for: chrome is defaulted, so without
    /// `deny_unknown_fields` a misspelled key parses fine, contributes nothing,
    /// and leaves the theme quietly flat with no issue to read. Serde's message
    /// names the key *and* lists what was expected, which is the whole hint an
    /// agent editing the file needs.
    #[test]
    fn a_misspelled_key_is_reported_rather_than_dropped() {
        for (json, offending) in [
            (r#"{"chasis": "rail"}"#, "chasis"),
            (r#"{"texture": {"halo": []}}"#, "halo"),
            (
                r##"{"texture": {"grain": {"color": "#fff", "opacity": 0.3,
                    "blend": "screen", "scale": 180, "mode": "x"}}}"##,
                "mode",
            ),
        ] {
            let error = serde_json::from_str::<ThemeChrome>(json).expect_err("must be reported");
            let message = error.to_string();
            assert!(message.contains(offending), "{message}");
            assert!(message.contains("expected one of"), "{message}");
        }
    }

    #[test]
    fn recognizes_paintable_extensions_case_insensitively() {
        assert_eq!(asset_extension("paper.PNG"), Some("png"));
        assert_eq!(asset_extension("a.b.webp"), Some("webp"));
        assert_eq!(asset_extension("paper.txt"), None);
        assert_eq!(asset_extension("paper"), None);
    }
}

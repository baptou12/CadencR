//! Cursor Agent release detection and self-update (`agent update`).
//!
//! Cursor publishes no package-registry feed. Its official installer script
//! pins the current build in its download URL
//! (`https://downloads.cursor.com/lab/<version>/…`), and `agent update`
//! installs that same build, so the script is the release source.

use std::sync::OnceLock;

use regex_lite::Regex;

use crate::domain::agents::updates::native_cli::LatestVersionFuture;
use crate::domain::agents::updates::UpdateError;

const INSTALL_SCRIPT_URL: &str = "https://cursor.com/install";

pub(crate) fn latest_version(http: &reqwest::Client) -> LatestVersionFuture<'_> {
    Box::pin(async move {
        let response = http.get(INSTALL_SCRIPT_URL).send().await.map_err(|error| {
            UpdateError::failed(format!("could not reach the Cursor installer: {error}"))
        })?;
        if !response.status().is_success() {
            return Err(UpdateError::failed(format!(
                "the Cursor installer answered {}",
                response.status()
            )));
        }
        let script = response.text().await.map_err(|error| {
            UpdateError::failed(format!("could not read the Cursor installer: {error}"))
        })?;
        version_from_install_script(&script).ok_or_else(|| {
            UpdateError::failed("the Cursor installer no longer names a release version")
        })
    })
}

fn version_from_install_script(script: &str) -> Option<String> {
    static MATCHER: OnceLock<Regex> = OnceLock::new();
    let regex = MATCHER.get_or_init(|| {
        Regex::new(r"downloads\.cursor\.com/lab/([0-9][0-9A-Za-z.\-]*)/")
            .expect("static installer regex")
    });
    regex
        .captures(script)
        .and_then(|captures| captures.get(1))
        .map(|version| version.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::version_from_install_script;

    #[test]
    fn reads_the_pinned_build_from_the_installer() {
        let script = r#"DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.14-0f9edde/${OS}/${ARCH}/agent-cli-package.tar.gz""#;
        assert_eq!(
            version_from_install_script(script).as_deref(),
            Some("2026.10.14-0f9edde")
        );
        assert_eq!(version_from_install_script("echo hello"), None);
    }
}

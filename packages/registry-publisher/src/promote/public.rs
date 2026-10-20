use std::path::Path;

use crate::binding::ExpectedArtifact;
use crate::mirror::artifacts::{combine_cleanup, OwnedDirectory};
use crate::{DownloadRequest, Downloader, PublisherError};

pub(crate) fn verify(
    expected: &[ExpectedArtifact],
    directory: &Path,
    downloader: &impl Downloader,
) -> Result<(), PublisherError> {
    verify_with_policy(expected, directory, downloader, None)
}

pub(crate) fn verify_theme_package(
    expected: &[ExpectedArtifact],
    directory: &Path,
    downloader: &impl Downloader,
) -> Result<(), PublisherError> {
    verify_with_policy(expected, directory, downloader, Some("theme"))
}

pub(crate) fn verify_tab_package(
    expected: &[ExpectedArtifact],
    directory: &Path,
    downloader: &impl Downloader,
) -> Result<(), PublisherError> {
    verify_with_policy(expected, directory, downloader, Some("tab"))
}

fn verify_with_policy(
    expected: &[ExpectedArtifact],
    directory: &Path,
    downloader: &impl Downloader,
    kind: Option<&str>,
) -> Result<(), PublisherError> {
    for artifact in expected {
        let temporary = OwnedDirectory::create(directory, ".promote-public-")?;
        let output = temporary.path().join("asset");
        let result = downloader.download(DownloadRequest {
            url: &artifact.expected_url,
            sha256: &artifact.sha256,
            output: output.clone(),
            max_bytes: artifact.size,
        });
        let result = result.and_then(|downloaded| {
            if downloaded.size != artifact.size || downloaded.sha256 != artifact.sha256 {
                return Err(PublisherError::new("public asset size does not match"));
            }
            if kind == Some("theme") && artifact.name == "theme.tar.gz" {
                cadencr_registry_core::verify_theme_archive(&output)?;
            }
            if kind == Some("tab") && artifact.name == "tab.tar.gz" {
                cadencr_registry_core::verify_tab_archive(&output)?;
            }
            Ok(())
        });
        combine_cleanup(result, temporary.remove())?;
    }
    Ok(())
}

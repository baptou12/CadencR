//! Public read-back of an object just written to a discovery branch, with the
//! bounded convergence rule shared by the catalog and the revocation policies.
use std::path::Path;
use std::time::{Duration, Instant};

use crate::download::{DiscoveryObservation, DiscoveryReader};
use crate::mirror::artifacts::{combine_cleanup, OwnedDirectory};
use crate::{DownloadRequest, PublisherError};

/// Read `url` until it serves exactly the candidate (`sha256`, `size`), taking
/// at most `max_bytes` of any body.
///
/// Raw CDN caches may keep serving the previous body for a while after the
/// write, so exactly the authenticated previous body (`previous_sha256`) is
/// retried until the budget ends; any other body is terminal. Before each
/// retry `revalidate` re-checks that the write is still the authoritative
/// state, so convergence can never mask a concurrent change or an expiry.
#[bon::builder]
pub(crate) fn verify_public_object(
    url: &str,
    file_name: &str,
    sha256: &str,
    size: u64,
    max_bytes: u64,
    previous_sha256: Option<&str>,
    directory: &Path,
    downloader: &impl DiscoveryReader,
    revalidate: &impl Fn(Instant) -> Result<(), PublisherError>,
    budget: Duration,
    pause: Duration,
    wait: &impl Fn(Duration),
) -> Result<(), PublisherError> {
    let deadline = Instant::now() + budget;
    let mut retry = false;
    loop {
        if retry {
            wait(pause.min(deadline.saturating_duration_since(Instant::now())));
            if Instant::now() >= deadline {
                return Err(exhausted());
            }
            revalidate(deadline)?;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(exhausted());
        }
        let temporary = OwnedDirectory::create(directory, ".discovery-public-")?;
        let observed = downloader.observe(
            DownloadRequest {
                url,
                sha256,
                output: temporary.path().join(file_name),
                max_bytes,
            },
            previous_sha256,
            deadline.saturating_duration_since(Instant::now()),
        );
        let observed = combine_cleanup(observed, temporary.remove())?;
        if Instant::now() >= deadline {
            return Err(exhausted());
        }
        match observed {
            DiscoveryObservation::Candidate(actual)
                if actual.size == size && actual.sha256 == sha256 =>
            {
                return Ok(())
            }
            DiscoveryObservation::Previous if previous_sha256.is_some() => retry = true,
            _ => {
                return Err(PublisherError::new(
                    "public discovery: candidate size or digest does not match",
                ))
            }
        }
    }
}

fn exhausted() -> PublisherError {
    PublisherError::new("public discovery: convergence read budget exhausted")
}

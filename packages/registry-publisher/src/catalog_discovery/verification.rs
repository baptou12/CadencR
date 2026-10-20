use std::path::Path;

use crate::github::discovery::DiscoveryClient;
use crate::github::ReleaseClient;
use crate::mirror::artifacts::{combine_cleanup, OwnedDirectory};
use crate::{DownloadRequest, Downloader, PublisherError};

pub(super) fn validate_remote_catalog(
    client: &(impl DiscoveryClient + ReleaseClient),
    snapshot: &cadencr_registry_core::CatalogSnapshot,
    release_id: u64,
) -> Result<(), PublisherError> {
    let release = client
        .find_release(snapshot.tag())?
        .ok_or_else(|| PublisherError::new("catalog release is missing"))?;
    crate::catalog_publish::validate_release(&release, snapshot, Some(release_id), Some(false))?;
    crate::promote::verify_exact_tag(
        client,
        snapshot.tag(),
        snapshot.registry_commit(),
        "before discovery advancement",
    )?;
    crate::mirror::artifacts::validated_named_asset(
        client.list_assets(release_id)?,
        crate::catalog_publish::ASSET,
        snapshot.size() as u64,
        snapshot.expected_url(),
    )?;
    Ok(())
}

pub(super) fn verify_public_catalog(
    snapshot: &cadencr_registry_core::CatalogSnapshot,
    directory: &Path,
    downloader: &impl Downloader,
) -> Result<(), PublisherError> {
    verify_download(
        snapshot.expected_url(),
        snapshot.sha256(),
        snapshot.size() as u64,
        directory,
        ".discovery-catalog-",
        downloader,
        "public catalog",
    )
}

pub(super) fn verify_raw(
    snapshot: &cadencr_registry_core::CatalogSnapshot,
    branch: &str,
    directory: &Path,
    downloader: &impl crate::download::DiscoveryReader,
    revalidate: &impl Fn(std::time::Instant) -> Result<(), PublisherError>,
) -> Result<(), PublisherError> {
    verify_raw_with()
        .snapshot(snapshot)
        .branch(branch)
        .directory(directory)
        .downloader(downloader)
        .revalidate(revalidate)
        .budget(std::time::Duration::from_secs(30))
        .pause(std::time::Duration::from_millis(250))
        .wait(&std::thread::sleep)
        .call()
}

#[bon::builder]
fn verify_raw_with(
    snapshot: &cadencr_registry_core::CatalogSnapshot,
    branch: &str,
    directory: &Path,
    downloader: &impl crate::download::DiscoveryReader,
    revalidate: &impl Fn(std::time::Instant) -> Result<(), PublisherError>,
    budget: std::time::Duration,
    pause: std::time::Duration,
    wait: &impl Fn(std::time::Duration),
) -> Result<(), PublisherError> {
    use crate::download::DiscoveryObservation;
    let url = cadencr_registry_core::discovery_url(snapshot.repository(), branch)?;
    let deadline = std::time::Instant::now() + budget;
    for attempt in 0..4 {
        if attempt > 0 {
            wait(pause.min(deadline.saturating_duration_since(std::time::Instant::now())));
            if std::time::Instant::now() >= deadline {
                return Err(exhausted());
            }
            revalidate(deadline)?;
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(exhausted());
        }
        let temporary = OwnedDirectory::create(directory, ".discovery-public-")?;
        let observed = downloader.observe(
            DownloadRequest {
                url: &url,
                sha256: snapshot.sha256(),
                output: temporary
                    .path()
                    .join(cadencr_registry_core::DISCOVERY_FILENAME),
                max_bytes: cadencr_registry_core::MAX_DISCOVERY_BYTES as u64,
            },
            snapshot.previous_sha256(),
            deadline.saturating_duration_since(std::time::Instant::now()),
        );
        let observed = combine_cleanup(observed, temporary.remove())?;
        if std::time::Instant::now() >= deadline {
            return Err(exhausted());
        }
        match observed {
            DiscoveryObservation::Candidate(actual)
                if actual.size == snapshot.size() as u64 && actual.sha256 == snapshot.sha256() =>
            {
                return Ok(())
            }
            DiscoveryObservation::Previous if snapshot.previous_sha256().is_some() => {}
            _ => {
                return Err(PublisherError::new(
                    "public discovery: candidate size or digest does not match",
                ))
            }
        }
    }
    Err(exhausted())
}

fn exhausted() -> PublisherError {
    PublisherError::new("public discovery: convergence read budget exhausted")
}

fn verify_download(
    url: &str,
    sha256: &str,
    size: u64,
    directory: &Path,
    prefix: &str,
    downloader: &impl Downloader,
    label: &str,
) -> Result<(), PublisherError> {
    let temporary = OwnedDirectory::create(directory, prefix)?;
    let result = downloader
        .download(DownloadRequest {
            url,
            sha256,
            output: temporary
                .path()
                .join(cadencr_registry_core::DISCOVERY_FILENAME),
            max_bytes: size,
        })
        .and_then(|actual| {
            if actual.size == size && actual.sha256 == sha256 {
                Ok(())
            } else {
                Err(PublisherError::new(format!(
                    "{label} size or digest does not match"
                )))
            }
        });
    combine_cleanup(result, temporary.remove())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::download::{DiscoveryObservation, DiscoveryReader};

    struct Reader<'a> {
        bytes: &'a [u8],
        calls: Cell<usize>,
        delay: Duration,
        replace_directory: bool,
    }
    impl DiscoveryReader for Reader<'_> {
        fn observe(
            &self,
            request: DownloadRequest<'_>,
            previous: Option<&str>,
            remaining: Duration,
        ) -> Result<DiscoveryObservation, PublisherError> {
            use sha2::{Digest as _, Sha256};
            self.calls.set(self.calls.get() + 1);
            assert!(!remaining.is_zero());
            assert!(remaining <= Duration::from_secs(1));
            std::thread::sleep(self.delay);
            if self.replace_directory {
                let parent = request.output.parent().unwrap();
                std::fs::rename(parent, parent.with_extension("displaced")).unwrap();
                std::fs::create_dir(parent).unwrap();
            }
            std::fs::write(&request.output, self.bytes).unwrap();
            crate::download::discovery::classify(
                crate::Downloaded {
                    sha256: crate::hex(&Sha256::digest(self.bytes)),
                    size: self.bytes.len() as u64,
                },
                Some(self.bytes.len() as u64),
                request.sha256,
                previous,
            )
        }
    }

    #[test]
    fn deadline_covers_backoff_guard_and_body_and_cleanup_failure_is_terminal() {
        let (value, _) = super::super::fixture::setup_baseline();
        let previous = std::fs::read(value.directory.join("previous.json")).unwrap();
        for mode in ["zero", "body", "guard", "backoff", "cleanup"] {
            let reader = Reader {
                bytes: if mode == "body" {
                    value.snapshot.canonical_envelope()
                } else {
                    &previous
                },
                calls: Cell::new(0),
                delay: if mode == "body" {
                    Duration::from_millis(400)
                } else {
                    Duration::ZERO
                },
                replace_directory: mode == "cleanup",
            };
            let guards = Cell::new(0);
            let guard = |_deadline: Instant| {
                guards.set(guards.get() + 1);
                if mode == "guard" {
                    std::thread::sleep(Duration::from_millis(400));
                }
                Ok(())
            };
            let wait = |duration| {
                if mode == "backoff" {
                    std::thread::sleep(duration);
                }
            };
            let started = Instant::now();
            let result = verify_raw_with()
                .snapshot(&value.snapshot)
                .branch("main")
                .directory(&value.directory)
                .downloader(&reader)
                .revalidate(&guard)
                .budget(if mode == "zero" {
                    Duration::ZERO
                } else {
                    Duration::from_millis(250)
                })
                .pause(Duration::from_millis(300))
                .wait(&wait)
                .call();
            assert!(result.is_err(), "{mode}");
            if mode == "cleanup" {
                assert!(result.unwrap_err().to_string().contains("identity changed"));
            }
            assert_eq!(reader.calls.get(), usize::from(mode != "zero"), "{mode}");
            assert_eq!(guards.get(), usize::from(mode == "guard"), "{mode}");
            assert!(started.elapsed() < Duration::from_secs(2));
            if mode != "cleanup" {
                assert!(!std::fs::read_dir(&value.directory)
                    .unwrap()
                    .any(|entry| entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".discovery-public-")));
            }
        }
    }
    #[test]
    fn stale_previous_raw_converges_to_candidate_without_second_cas() {
        use super::super::fixture::Sequence;
        let (value, _) = super::super::fixture::setup_baseline();
        let previous = std::fs::read(value.directory.join("previous.json")).unwrap();
        value.client.set_discovery_head(previous.clone());
        let raw = Sequence {
            bodies: vec![previous.clone(), value.snapshot.canonical_envelope().into()],
            calls: Cell::new(0),
        };
        let first = super::super::lifecycle::advance_with(
            &value.snapshot,
            &value.manifest,
            &value.directory,
            "main",
            &value.client,
            &value.downloader,
            &raw,
        )
        .unwrap();
        assert_eq!(raw.calls.get(), 2);
        assert_eq!(value.client.discovery_counts().1, 1);
        let receipt_bytes =
            std::fs::read(value.directory.join(super::super::receipt::RECEIPT)).unwrap();
        raw.calls.set(0);
        let replay = super::super::lifecycle::advance_with(
            &value.snapshot,
            &value.manifest,
            &value.directory,
            "main",
            &value.client,
            &value.downloader,
            &raw,
        )
        .unwrap();
        assert_eq!(first, replay);
        assert_eq!(raw.calls.get(), 2);
        assert_eq!(value.client.discovery_counts().1, 1);
        assert_eq!(
            std::fs::read(value.directory.join(super::super::receipt::RECEIPT)).unwrap(),
            receipt_bytes
        );
    }

    #[test]
    fn only_previous_bytes_can_delay_verification_and_never_skip_guards() {
        use super::super::fixture::Sequence;
        for mode in "persistent tamper bootstrap drift expiry expiry_after".split_whitespace() {
            let (value, _) = if mode == "bootstrap" {
                super::super::fixture::setup()
            } else {
                super::super::fixture::setup_baseline()
            };
            let previous = if mode == "bootstrap" {
                b"unknown".to_vec()
            } else {
                std::fs::read(value.directory.join("previous.json")).unwrap()
            };
            if mode != "bootstrap" {
                value.client.set_discovery_head(previous.clone());
            }
            if mode == "drift" {
                value.client.drift_discovery_at(4);
            }
            let first = if mode == "tamper" {
                b"tampered".to_vec()
            } else {
                previous
            };
            let bodies = if mode == "persistent" {
                vec![first]
            } else {
                vec![first, value.snapshot.canonical_envelope().into()]
            };
            let raw = Sequence {
                bodies,
                calls: Cell::new(0),
            };
            let fresh_calls = Cell::new(0);
            let fresh = || {
                fresh_calls.set(fresh_calls.get() + 1);
                if (mode == "expiry" && fresh_calls.get() == 3)
                    || (mode == "expiry_after" && fresh_calls.get() == 4)
                {
                    Err(PublisherError::new("expired"))
                } else {
                    Ok(())
                }
            };
            assert!(
                super::super::lifecycle::advance_with_freshness()
                    .snapshot(&value.snapshot)
                    .manifest(&value.manifest)
                    .directory(&value.directory)
                    .branch("main")
                    .client(&value.client)
                    .catalog_downloader(&value.downloader)
                    .discovery_downloader(&raw)
                    .freshness(&fresh)
                    .call()
                    .is_err(),
                "{mode}"
            );
            assert_eq!(
                raw.calls.get(),
                if mode == "persistent" { 4 } else { 1 },
                "{mode}"
            );
            assert_eq!(value.client.discovery_counts().1, 1);
            assert!(!value
                .directory
                .join(super::super::receipt::RECEIPT)
                .exists());
            assert!(!std::fs::read_dir(&value.directory)
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".discovery-public-")));
        }
    }
}

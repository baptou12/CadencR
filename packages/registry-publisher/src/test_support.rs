//! Doubles shared by the publisher's unit tests.
use std::cell::Cell;

use sha2::{Digest as _, Sha256};

use crate::download::{DiscoveryObservation, DiscoveryReader};
use crate::{DownloadRequest, Downloaded, PublisherError};

// Deterministic synthetic fixture key pair; never a release credential.
pub(crate) const PRIVATE: &str = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH\n-----END PRIVATE KEY-----\n";
pub(crate) const PUBLIC: &str = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=\n-----END PUBLIC KEY-----\n";

/// Public raw reads served from a script; the last body repeats. Bodies pass
/// the same typed classifier as raw HTTP.
pub(crate) struct ScriptedFeed {
    pub(crate) bodies: Vec<Vec<u8>>,
    pub(crate) calls: Cell<usize>,
}

impl ScriptedFeed {
    pub(crate) fn new(bodies: Vec<Vec<u8>>) -> Self {
        Self {
            bodies,
            calls: Cell::new(0),
        }
    }
}

impl DiscoveryReader for ScriptedFeed {
    fn observe(
        &self,
        request: DownloadRequest<'_>,
        previous: Option<&str>,
        _remaining: std::time::Duration,
    ) -> Result<DiscoveryObservation, PublisherError> {
        let call = self.calls.get();
        self.calls.set(call + 1);
        let bytes = &self.bodies[call.min(self.bodies.len() - 1)];
        std::fs::write(&request.output, bytes).unwrap();
        crate::download::discovery::classify(
            Downloaded {
                sha256: crate::hex(&Sha256::digest(bytes)),
                size: bytes.len() as u64,
            },
            Some(bytes.len() as u64),
            request.sha256,
            previous,
        )
    }
}

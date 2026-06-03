//! Short-lived, single-use pairing codes. The QR/URL embeds a code (never a
//! device token); a new device exchanges it at `/api/remote/pair` for a durable
//! device token. Codes live only in memory — a restart invalidates pending
//! ones, which is acceptable (re-show the QR).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const CODE_TTL: Duration = Duration::from_secs(120);
const CODE_BYTES: usize = 24;

/// In-memory store of `sha256(code)` → expiry. We store the hash (not the raw
/// code) so a memory dump doesn't reveal currently-valid codes.
#[derive(Default)]
pub struct PairingCodes {
    inner: Mutex<HashMap<String, Instant>>,
}

pub struct MintedCode {
    pub code: String,
    pub expires_in_secs: u64,
}

impl PairingCodes {
    /// Mint a fresh single-use code valid for [`CODE_TTL`]. Only one code is ever
    /// active: minting a new one invalidates any prior code (the host UI shows a
    /// single QR, and "New code" should make the old link stop working — a
    /// smaller window and a less surprising model than several live at once).
    pub fn mint(&self) -> MintedCode {
        let code = random_code();
        let mut inner = self.inner.lock().unwrap();
        inner.clear();
        inner.insert(hash_code(&code), Instant::now() + CODE_TTL);
        MintedCode {
            code,
            expires_in_secs: CODE_TTL.as_secs(),
        }
    }

    /// Validate and consume a code. Returns true exactly once per minted code,
    /// and only before it expires.
    pub fn consume(&self, code: &str) -> bool {
        let presented = hash_code(code);
        let mut inner = self.inner.lock().unwrap();
        prune(&mut inner);
        let matched = inner
            .keys()
            .find(|stored| bool::from(stored.as_bytes().ct_eq(presented.as_bytes())))
            .cloned();
        match matched {
            Some(key) => {
                inner.remove(&key);
                true
            }
            None => false,
        }
    }
}

fn prune(map: &mut HashMap<String, Instant>) {
    let now = Instant::now();
    map.retain(|_, expiry| *expiry > now);
}

fn random_code() -> String {
    let mut bytes = [0u8; CODE_BYTES];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_code(code: &str) -> String {
    let digest = Sha256::digest(code.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_is_single_use() {
        let codes = PairingCodes::default();
        let minted = codes.mint();
        assert!(codes.consume(&minted.code), "first use succeeds");
        assert!(!codes.consume(&minted.code), "second use fails");
    }

    #[test]
    fn unknown_code_is_rejected() {
        let codes = PairingCodes::default();
        codes.mint();
        assert!(!codes.consume("not-a-real-code"));
    }

    #[test]
    fn minting_invalidates_the_previous_code() {
        let codes = PairingCodes::default();
        let first = codes.mint();
        let second = codes.mint();
        assert!(!codes.consume(&first.code), "old code is no longer valid");
        assert!(codes.consume(&second.code), "newest code still works");
    }
}

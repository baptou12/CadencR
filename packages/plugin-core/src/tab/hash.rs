//! The permissions hash consent is recorded against.
//!
//! SHA-256 (lowercase hex) of the canonical JSON
//! `{"permissions":[sorted],"allowed_origins":[sorted]}`. Anything that widens
//! what a tab can reach changes the hash, so a stored consent stops matching
//! and the user is asked again. Labels, version bumps and configuration do not.

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::manifest::TabManifest;

#[derive(Serialize)]
struct Canonical<'a> {
    permissions: Vec<&'a str>,
    allowed_origins: Vec<&'a str>,
}

pub(crate) fn permissions_hash(permissions: &[String], allowed_origins: &[String]) -> String {
    let mut permissions: Vec<&str> = permissions.iter().map(String::as_str).collect();
    let mut allowed_origins: Vec<&str> = allowed_origins.iter().map(String::as_str).collect();
    permissions.sort_unstable();
    allowed_origins.sort_unstable();
    let canonical = serde_json::to_vec(&Canonical {
        permissions,
        allowed_origins,
    })
    .expect("a struct of string lists always serializes");
    Sha256::digest(&canonical)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

impl TabManifest {
    /// See the module docs.
    pub fn permissions_hash(&self) -> String {
        permissions_hash(&self.permissions, self.allowed_origins())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn hashes_the_documented_canonical_json() {
        let expected: String = Sha256::digest(
            br#"{"permissions":["features:read","git:read"],"allowed_origins":["https://a.example"]}"#,
        )
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
        assert_eq!(
            permissions_hash(
                &strings(&["git:read", "features:read"]),
                &strings(&["https://a.example"])
            ),
            expected
        );
        assert_eq!(expected.len(), 64);
    }

    #[test]
    fn order_does_not_matter_but_widening_does() {
        let base = permissions_hash(&strings(&["a", "b"]), &strings(&["x", "y"]));
        assert_eq!(
            base,
            permissions_hash(&strings(&["b", "a"]), &strings(&["y", "x"]))
        );
        assert_ne!(
            base,
            permissions_hash(&strings(&["a", "b", "c"]), &strings(&["x", "y"]))
        );
        assert_ne!(
            base,
            permissions_hash(&strings(&["a", "b"]), &strings(&["x", "y", "z"]))
        );
        // A scope moved into the origin list is a different grant.
        assert_ne!(
            permissions_hash(&strings(&["a"]), &[]),
            permissions_hash(&[], &strings(&["a"]))
        );
    }
}

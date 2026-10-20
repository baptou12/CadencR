//! The permissions hash consent is recorded against.
//!
//! SHA-256 (lowercase hex) of the canonical JSON
//! `{"permissions":[sorted],"allowed_origins":[sorted]}`, plus
//! `"commands":[sorted programs]` when the tab lists commands and
//! `"backend":{"command":…,"args":[…]}` when it ships a backend. The two
//! later keys are omitted when empty, so a tab that declares neither keeps the
//! hash it was consented under. Anything that widens what a tab can reach or
//! run changes the hash, so a stored consent stops matching and the user is
//! asked again. Labels, reasons, version bumps and configuration do not.

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::manifest::TabManifest;

#[derive(Serialize)]
struct Canonical<'a> {
    permissions: Vec<&'a str>,
    allowed_origins: Vec<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    commands: Vec<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backend: Option<CanonicalBackend<'a>>,
}

#[derive(Serialize)]
struct CanonicalBackend<'a> {
    command: &'a str,
    args: &'a [String],
}

/// What widens a tab beyond its page: the commands it may run and the
/// backend it launches.
#[derive(Default)]
pub(crate) struct Execution<'a> {
    pub commands: Vec<&'a str>,
    pub backend: Option<(&'a str, &'a [String])>,
}

pub(crate) fn permissions_hash(
    permissions: &[String],
    allowed_origins: &[String],
    execution: Execution<'_>,
) -> String {
    let mut permissions: Vec<&str> = permissions.iter().map(String::as_str).collect();
    let mut allowed_origins: Vec<&str> = allowed_origins.iter().map(String::as_str).collect();
    let mut commands = execution.commands;
    permissions.sort_unstable();
    allowed_origins.sort_unstable();
    commands.sort_unstable();
    let canonical = serde_json::to_vec(&Canonical {
        permissions,
        allowed_origins,
        commands,
        backend: execution
            .backend
            .map(|(command, args)| CanonicalBackend { command, args }),
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
        let execution = Execution {
            commands: self
                .commands
                .iter()
                .map(|command| command.program.as_str())
                .collect(),
            backend: self
                .backend
                .as_ref()
                .map(|backend| (backend.command.as_str(), backend.args.as_slice())),
        };
        permissions_hash(&self.permissions, self.allowed_origins(), execution)
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
                &strings(&["https://a.example"]),
                Execution::default()
            ),
            expected
        );
        assert_eq!(expected.len(), 64);
    }

    #[test]
    fn order_does_not_matter_but_widening_does() {
        let base = permissions_hash(
            &strings(&["a", "b"]),
            &strings(&["x", "y"]),
            Execution::default(),
        );
        assert_eq!(
            base,
            permissions_hash(
                &strings(&["b", "a"]),
                &strings(&["y", "x"]),
                Execution::default()
            )
        );
        assert_ne!(
            base,
            permissions_hash(
                &strings(&["a", "b", "c"]),
                &strings(&["x", "y"]),
                Execution::default()
            )
        );
        assert_ne!(
            base,
            permissions_hash(
                &strings(&["a", "b"]),
                &strings(&["x", "y", "z"]),
                Execution::default()
            )
        );
        // A scope moved into the origin list is a different grant.
        assert_ne!(
            permissions_hash(&strings(&["a"]), &[], Execution::default()),
            permissions_hash(&[], &strings(&["a"]), Execution::default())
        );
    }

    #[test]
    fn commands_and_backend_widen_the_hash_only_when_declared() {
        let plain = permissions_hash(&strings(&["a"]), &[], Execution::default());
        let expected: String = Sha256::digest(br#"{"permissions":["a"],"allowed_origins":[]}"#)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(plain, expected, "tabs without commands keep their hash");
        let git = || Execution {
            commands: vec!["jq", "git"],
            backend: None,
        };
        let with_commands = permissions_hash(&strings(&["a"]), &[], git());
        assert_ne!(plain, with_commands);
        assert_eq!(
            with_commands,
            permissions_hash(
                &strings(&["a"]),
                &[],
                Execution {
                    commands: vec!["git", "jq"],
                    backend: None
                }
            )
        );
        let args = strings(&["backend/server.mjs"]);
        let with_backend = permissions_hash(
            &strings(&["a"]),
            &[],
            Execution {
                commands: vec!["git", "jq"],
                backend: Some(("node", &args)),
            },
        );
        assert_ne!(with_commands, with_backend);
        let other_args = strings(&["backend/other.mjs"]);
        assert_ne!(
            with_backend,
            permissions_hash(
                &strings(&["a"]),
                &[],
                Execution {
                    commands: vec!["git", "jq"],
                    backend: Some(("node", &other_args)),
                },
            )
        );
    }
}

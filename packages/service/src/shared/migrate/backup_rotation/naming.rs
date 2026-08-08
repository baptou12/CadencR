//! Strict, database-scoped names for managed pre-migration snapshots.

use std::path::{Path, PathBuf};

pub(super) const BACKUP_SUFFIX: &str = ".cadencr.backup.db";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Snapshot {
    pub path: PathBuf,
    pub identity: String,
    pub version: String,
    /// `%Y-%m-%d-%H`, which sorts lexicographically in chronological order.
    pub timestamp: String,
}

/// Stable within one directory: two differently named custom databases can
/// never claim or prune each other's snapshots.
pub(in crate::shared::migrate) fn database_identity(db_path: &Path) -> Option<String> {
    let name = db_path.file_name()?.to_string_lossy();
    let mut encoded = String::with_capacity(3 + name.len() * 2);
    encoded.push_str("db-");
    for byte in name.as_bytes() {
        use std::fmt::Write as _;
        let _ = write!(encoded, "{byte:02x}");
    }
    Some(encoded)
}

pub(in crate::shared::migrate) fn backup_file_name(
    db_path: &Path,
    version: &str,
    timestamp: &str,
) -> Option<String> {
    if !valid_version(version) || !valid_timestamp(timestamp) {
        return None;
    }
    Some(format!(
        "{}.{}.{}{}",
        database_identity(db_path)?,
        version,
        timestamp,
        BACKUP_SUFFIX
    ))
}

/// Parse only the new identity-bearing shape. Legacy version-only snapshots
/// are deliberately unmanaged: without a source identity they are ambiguous,
/// so neither rotation nor automatic recovery may touch them.
pub(super) fn parse_snapshot(path: &Path) -> Option<Snapshot> {
    let name = path.file_name()?.to_str()?;
    let stem = name.strip_suffix(BACKUP_SUFFIX)?;
    let (identity, version_and_timestamp) = stem.split_once('.')?;
    let (version, timestamp) = version_and_timestamp.rsplit_once('.')?;
    if !valid_identity(identity) || !valid_version(version) || !valid_timestamp(timestamp) {
        return None;
    }
    Some(Snapshot {
        path: path.to_path_buf(),
        identity: identity.to_string(),
        version: version.to_string(),
        timestamp: timestamp.to_string(),
    })
}

/// Recover the original custom database filename from a managed snapshot.
/// Production snapshots already share `<base>/blobs`; this is for custom paths
/// where blob roots are named after the database file.
pub(crate) fn source_database_file_name(backup_path: &Path) -> Option<String> {
    let snapshot = parse_snapshot(backup_path)?;
    let hex = snapshot.identity.strip_prefix("db-")?;
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(hex.get(index..index + 2)?, 16).ok())
        .collect::<Option<Vec<_>>>()?;
    let name = String::from_utf8(bytes).ok()?;
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return None;
    }
    Some(name)
}

fn valid_identity(identity: &str) -> bool {
    let Some(hex) = identity.strip_prefix("db-") else {
        return false;
    };
    !hex.is_empty()
        && hex.len() % 2 == 0
        && hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(super) fn valid_version(version: &str) -> bool {
    let safe = version
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'));
    if !safe {
        return false;
    }
    let without_v = version.strip_prefix('v').unwrap_or(version);
    let core = without_v.split(['-', '+']).next().unwrap_or_default();
    let segments: Vec<&str> = core.split('.').collect();
    (2..=3).contains(&segments.len())
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit()))
}

fn valid_timestamp(timestamp: &str) -> bool {
    if timestamp.len() != 13 {
        return false;
    }
    let bytes = timestamp.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'-' {
        return false;
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| !matches!(index, 4 | 7 | 10) && !byte.is_ascii_digit())
    {
        return false;
    }
    let parse = |range: std::ops::Range<usize>| timestamp.get(range)?.parse::<u32>().ok();
    matches!(parse(0..4), Some(1..=9999))
        && matches!(parse(5..7), Some(1..=12))
        && matches!(parse(8..10), Some(1..=31))
        && matches!(parse(11..13), Some(0..=23))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_database_identity() {
        let db = Path::new("/custom/second.db");
        let name = backup_file_name(db, "0.9.1", "2026-08-06-10").unwrap();
        let path = Path::new("/custom").join(name);
        let parsed = parse_snapshot(&path).unwrap();
        assert_eq!(parsed.identity, database_identity(db).unwrap());
        assert_eq!(
            source_database_file_name(&path).as_deref(),
            Some("second.db")
        );
    }

    #[test]
    fn rejects_legacy_and_malformed_names() {
        for name in [
            "0.9.1.2026-08-06-10.cadencr.backup.db",
            "db-zz.0.9.1.2026-08-06-10.cadencr.backup.db",
            "db-61.unsafe/version.2026-08-06-10.cadencr.backup.db",
            "db-61.0.9.1.2026-99-99-99.cadencr.backup.db",
        ] {
            assert!(parse_snapshot(Path::new(name)).is_none(), "{name}");
        }
    }
}

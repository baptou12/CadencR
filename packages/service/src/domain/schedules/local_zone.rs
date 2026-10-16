//! The machine's IANA timezone, for schedules created without one.
//!
//! The desktop editor always sends the viewer's zone. An agent creating a
//! schedule over MCP usually doesn't know it, and defaulting its "every day at
//! 09:00" to UTC would fire at the wrong hour for nearly everyone. The service
//! runs on the user's machine, so the machine's zone is the user's.

use chrono_tz::Tz;

/// `$TZ` when it names a zone, else the `/etc/localtime` symlink target, else
/// `UTC`.
pub fn local_timezone() -> String {
    std::env::var("TZ")
        .ok()
        .and_then(|raw| valid_zone(raw.trim_start_matches(':')))
        .or_else(|| {
            std::fs::read_link("/etc/localtime")
                .ok()
                .and_then(|target| zone_from_path(&target.to_string_lossy()))
        })
        .unwrap_or_else(|| "UTC".to_string())
}

/// `/var/db/timezone/zoneinfo/Europe/Paris` (macOS) or
/// `/usr/share/zoneinfo/Europe/Paris` (Linux) → `Europe/Paris`.
fn zone_from_path(path: &str) -> Option<String> {
    let (_, zone) = path.rsplit_once("zoneinfo/")?;
    valid_zone(zone)
}

fn valid_zone(raw: &str) -> Option<String> {
    raw.parse::<Tz>().ok().map(|_| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_is_read_from_either_platform_layout() {
        assert_eq!(
            zone_from_path("/var/db/timezone/zoneinfo/Europe/Paris").as_deref(),
            Some("Europe/Paris")
        );
        assert_eq!(
            zone_from_path("/usr/share/zoneinfo/America/New_York").as_deref(),
            Some("America/New_York")
        );
        assert_eq!(zone_from_path("/usr/share/zoneinfo/Not/AZone"), None);
        assert_eq!(zone_from_path("/etc/localtime"), None);
    }

    #[test]
    fn the_fallback_is_always_a_valid_zone() {
        assert!(local_timezone().parse::<Tz>().is_ok());
    }
}

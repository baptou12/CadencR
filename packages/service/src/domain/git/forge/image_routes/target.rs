//! Where a pull request's `<img src>` actually points, and whether we are
//! willing to go there.
//!
//! Split out of the handler because these are the two decisions worth testing
//! on their own: a forge writes image sources in four different shapes, and the
//! answer to "may the forge token travel with this request" has to be a
//! property of the host rather than of the call site.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use reqwest::Url;

use crate::domain::git::host::{GitHost, RemoteInfo};
use crate::error::AppError;

/// Resolve an image source from a PR body into an absolute URL.
///
/// Forges emit four shapes and each resolves differently:
/// absolute (`https://…`), protocol-relative (`//host/…`), site-root-relative
/// (`/owner/repo/…`), and repository-relative (`docs/logo.png`, which the web
/// UI serves from the head commit).
pub fn resolve_image_url(
    remote: &RemoteInfo,
    kind: GitHost,
    head_sha: Option<&str>,
    raw: &str,
) -> Result<Url, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("An image URL is required".into()));
    }
    // `//host/path` means "same scheme as the page". The page is a forge over
    // HTTPS, so that is the scheme it inherits.
    if let Some(rest) = trimmed.strip_prefix("//") {
        return parse_absolute(&format!("https://{rest}"));
    }
    if let Ok(url) = Url::parse(trimmed) {
        return Ok(url);
    }
    repository_relative_url(remote, kind, head_sha, trimmed)
}

fn parse_absolute(candidate: &str) -> Result<Url, AppError> {
    Url::parse(candidate)
        .map_err(|error| AppError::BadRequest(format!("Unreadable image URL: {error}")))
}

fn repository_relative_url(
    remote: &RemoteInfo,
    kind: GitHost,
    head_sha: Option<&str>,
    path: &str,
) -> Result<Url, AppError> {
    // `web_base` is already the repository's own page — `https://host/owner/repo`
    // — so the site root has to be rebuilt from the hostname rather than
    // assumed. Reading it as an origin appends `owner/repo` a second time and
    // 404s every repository-relative image.
    let project = remote.web_base.trim_end_matches('/');
    let site = format!("https://{}", remote.hostname);
    // GitLab writes attachments as `/uploads/<secret>/<name>`, which reads like
    // a site-root path but is served from the *project*. Joining it against the
    // origin — the obvious thing — sends every uploaded screenshot to a 404.
    if let Some(upload) = path.strip_prefix("/uploads/") {
        return parse_absolute(&format!("{project}/uploads/{upload}"));
    }
    if let Some(rooted) = path.strip_prefix('/') {
        return parse_absolute(&format!("{site}/{rooted}"));
    }
    let sha = head_sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "This image is stored in the repository, and the pull request's head commit is not known yet".into(),
            )
        })?;
    let raw_path = match kind {
        GitHost::GitLab => format!("{project}/-/raw/{sha}/{path}"),
        _ => format!("{project}/raw/{sha}/{path}"),
    };
    parse_absolute(&raw_path)
}

/// Whether the forge that hosts this pull request also owns `host` — i.e.
/// whether the configured token may travel with a request to it.
///
/// Everything else is still fetched, just anonymously: a shields.io badge in a
/// PR description is an ordinary image, but it has no business seeing a token
/// that unlocks the user's repositories.
pub fn is_forge_owned_host(remote: &RemoteInfo, kind: GitHost, host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if is_within(&host, &remote.hostname.to_ascii_lowercase()) {
        return true;
    }
    // Cloud forges serve assets from a sibling domain: a GitHub attachment
    // lives on `*.githubusercontent.com`, and a private one only answers a
    // request that carries the token.
    match kind {
        GitHost::GitHub => is_within(&host, "githubusercontent.com"),
        GitHost::GitLab => is_within(&host, "gitlab-static.net"),
        GitHost::Bitbucket => is_within(&host, "bitbucket.org"),
        GitHost::Other => false,
    }
}

/// `host` is `domain` itself or a subdomain of it — never a mere suffix match,
/// which would hand `evil-github.com` the credentials for `github.com`.
fn is_within(host: &str, domain: &str) -> bool {
    !domain.is_empty()
        && (host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|head| head.ends_with('.')))
}

/// Refuse a URL before it becomes a request.
///
/// The service is a local process on the user's machine, and a pull request
/// body is attacker-influenced text, so an unrestricted fetch would let a
/// crafted `<img>` probe the machine's own network. HTTPS-only plus a
/// private-address refusal keeps the proxy pointed outward.
pub fn ensure_fetchable(url: &Url) -> Result<(), AppError> {
    if url.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Only HTTPS images are loaded, so the request cannot be read in transit".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::BadRequest(
            "An image URL cannot carry credentials".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::BadRequest("Image URL is missing a host".into()))?;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let reachable = match bare.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => is_public_v4(address),
        Ok(IpAddr::V6(address)) => is_public_v6(address),
        Err(_) => is_public_domain(bare),
    };
    if !reachable {
        return Err(AppError::BadRequest(format!(
            "Images are only loaded from public hosts, and {host} is not one"
        )));
    }
    Ok(())
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_unspecified()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_multicast()
        // 100.64.0.0/10 (carrier-grade NAT) — `is_shared` is still unstable.
        || (address.octets()[0] == 100 && (64..128).contains(&address.octets()[1])))
}

fn is_public_v6(address: Ipv6Addr) -> bool {
    let first = address.segments()[0];
    !(address.is_loopback()
        || address.is_unspecified()
        || address.is_multicast()
        // fc00::/7 unique-local, fe80::/10 link-local.
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        // ::ffff:a.b.c.d — an IPv4 private address wearing a v6 hat.
        || address
            .to_ipv4_mapped()
            .is_some_and(|mapped| !is_public_v4(mapped)))
}

fn is_public_domain(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    // A single label ("router") or an mDNS/AD suffix only ever resolves on the
    // local network.
    host.contains('.')
        && !["localhost", "local", "internal", "home", "lan", "intranet"]
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped exactly like `detect_remote` builds one — in particular
    /// `web_base` is the *repository* page, not the site root. A fixture that
    /// got that wrong is what let the double-`owner/repo` bug through.
    fn remote(hostname: &str, host: GitHost) -> RemoteInfo {
        RemoteInfo {
            host,
            hostname: hostname.into(),
            web_base: format!("https://{hostname}/acme/repo"),
            owner: "acme".into(),
            repo: "repo".into(),
        }
    }

    fn github() -> RemoteInfo {
        remote("github.com", GitHost::GitHub)
    }

    fn resolve(raw: &str) -> String {
        resolve_image_url(&github(), GitHost::GitHub, Some("abc123"), raw)
            .expect("resolvable image source")
            .to_string()
    }

    #[test]
    fn absolute_and_protocol_relative_sources_keep_their_host() {
        assert_eq!(
            resolve("https://avatars.githubusercontent.com/u/1?v=4"),
            "https://avatars.githubusercontent.com/u/1?v=4"
        );
        assert_eq!(
            resolve("//user-images.githubusercontent.com/1/shot.png"),
            "https://user-images.githubusercontent.com/1/shot.png"
        );
    }

    #[test]
    fn a_repository_relative_source_is_served_from_the_head_commit() {
        // A screenshot committed alongside the change is the common case for a
        // relative `src`, and the branch it lives on is the PR's head.
        assert_eq!(
            resolve("docs/screenshot.png"),
            "https://github.com/acme/repo/raw/abc123/docs/screenshot.png"
        );
        let gitlab = remote("gitlab.com", GitHost::GitLab);
        assert_eq!(
            resolve_image_url(&gitlab, GitHost::GitLab, Some("abc123"), "docs/shot.png")
                .unwrap()
                .to_string(),
            "https://gitlab.com/acme/repo/-/raw/abc123/docs/shot.png"
        );
    }

    #[test]
    fn a_gitlab_upload_resolves_against_the_project_not_the_origin() {
        // The bug this covers: `/uploads/...` looks site-root-relative, so a
        // plain join produced `https://gitlab.com/uploads/...` — a 404 for
        // every image a reviewer ever pasted into a merge request.
        let gitlab = remote("gitlab.com", GitHost::GitLab);
        assert_eq!(
            resolve_image_url(&gitlab, GitHost::GitLab, None, "/uploads/deadbeef/shot.png")
                .unwrap()
                .to_string(),
            "https://gitlab.com/acme/repo/uploads/deadbeef/shot.png"
        );
    }

    #[test]
    fn a_repository_relative_source_without_a_head_commit_explains_itself() {
        let error = resolve_image_url(&github(), GitHost::GitHub, None, "docs/shot.png")
            .expect_err("no commit to resolve against");
        assert!(
            matches!(&error, AppError::BadRequest(message) if message.contains("head commit")),
            "{error:?}"
        );
    }

    #[test]
    fn credentials_travel_to_the_forge_and_its_asset_domain_only() {
        let remote = github();
        for host in [
            "github.com",
            "raw.github.com",
            "avatars.githubusercontent.com",
            "private-user-images.githubusercontent.com",
        ] {
            assert!(
                is_forge_owned_host(&remote, GitHost::GitHub, host),
                "{host}"
            );
        }
        for host in [
            "img.shields.io",
            "secure.gravatar.com",
            // The suffix trap: a lookalike host must never be read as a
            // subdomain of the real one.
            "evil-github.com",
            "notgithubusercontent.com",
        ] {
            assert!(
                !is_forge_owned_host(&remote, GitHost::GitHub, host),
                "{host}"
            );
        }
    }

    #[test]
    fn a_self_hosted_forge_owns_its_own_subdomains() {
        let remote = remote("git.example.com", GitHost::GitLab);
        assert!(is_forge_owned_host(
            &remote,
            GitHost::GitLab,
            "assets.git.example.com"
        ));
        assert!(!is_forge_owned_host(
            &remote,
            GitHost::GitLab,
            "git.example.com.attacker.test"
        ));
    }

    #[test]
    fn only_public_https_hosts_are_fetched() {
        for allowed in [
            "https://github.com/a.png",
            "https://8.8.8.8/a.png",
            "https://[2606:4700::1]/a.png",
        ] {
            ensure_fetchable(&Url::parse(allowed).unwrap()).expect(allowed);
        }
        for refused in [
            "http://github.com/a.png",
            "https://user:pass@github.com/a.png",
            "https://127.0.0.1/a.png",
            "https://10.0.0.5/a.png",
            "https://192.168.1.20/a.png",
            "https://169.254.169.254/latest/meta-data",
            "https://[::1]/a.png",
            "https://[fd00::1]/a.png",
            "https://localhost/a.png",
            "https://printer.local/a.png",
            "https://intranet/a.png",
        ] {
            assert!(
                ensure_fetchable(&Url::parse(refused).unwrap()).is_err(),
                "{refused}"
            );
        }
    }
}

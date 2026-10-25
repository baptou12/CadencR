//! The write discipline every file on a discovery branch follows, shared by
//! the catalog and the revocation policies: judge the head you read, write
//! once conditionally on that exact blob, and trust only a read-back of the
//! candidate itself.
use super::DiscoveryHead;
use crate::PublisherError;

/// `head` holds exactly `candidate`.
pub(crate) fn require_candidate(
    head: Option<&DiscoveryHead>,
    candidate: &[u8],
    subject: &str,
) -> Result<(), PublisherError> {
    if head.is_some_and(|head| head.bytes == candidate) {
        Ok(())
    } else {
        Err(PublisherError::new(format!(
            "{subject} does not contain the candidate"
        )))
    }
}

/// The branch still holds what was assessed; `change` names the refusal.
pub(crate) fn require_same_head(
    expected: Option<&DiscoveryHead>,
    actual: Option<&DiscoveryHead>,
    change: &str,
) -> Result<(), PublisherError> {
    if expected == actual {
        Ok(())
    } else {
        Err(PublisherError::new(change))
    }
}

/// One conditional write. A failed or lost response is reconciled by reading
/// back: only the candidate itself counts as success, anything else returns
/// the write's own error.
pub(crate) fn set_or_reconcile(
    candidate: &[u8],
    subject: &str,
    set: impl FnOnce() -> Result<(), PublisherError>,
    read: impl Fn() -> Result<Option<DiscoveryHead>, PublisherError>,
) -> Result<DiscoveryHead, PublisherError> {
    match set() {
        Ok(()) => read()?.ok_or_else(|| {
            PublisherError::new(format!("{subject} does not contain the candidate"))
        }),
        Err(primary) => match read()? {
            Some(winner) if winner.bytes == candidate => Ok(winner),
            _ => Err(primary),
        },
    }
}

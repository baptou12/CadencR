use super::*;
use crate::blocklist::{
    prepare_blocklist, BlocklistEntry, MAX_BLOCKLIST_BYTES, SIGNED_OVERHEAD_BYTES,
};
use crate::{TabBlocklistEntry, ThemeBlocklistEntry};

pub fn sign_theme_blocklist(
    payload_file: &Path,
    private_key_file: &Path,
    key_id: &str,
) -> Result<Vec<u8>, RegistryError> {
    sign_blocklist::<ThemeBlocklistEntry>(payload_file, private_key_file, key_id)
}

pub fn verify_signed_theme_blocklist(
    index_file: &Path,
    public_key_file: &Path,
    key_id: &str,
    allow_expired: bool,
) -> Result<(), RegistryError> {
    verify_blocklist::<ThemeBlocklistEntry>(index_file, public_key_file, key_id, allow_expired)
}

/// Sign a custom-tab revocation policy (`kind: "tab-blocklist"`) with the
/// catalog key.
pub fn sign_tab_blocklist(
    payload_file: &Path,
    private_key_file: &Path,
    key_id: &str,
) -> Result<Vec<u8>, RegistryError> {
    sign_blocklist::<TabBlocklistEntry>(payload_file, private_key_file, key_id)
}

pub fn verify_signed_tab_blocklist(
    index_file: &Path,
    public_key_file: &Path,
    key_id: &str,
    allow_expired: bool,
) -> Result<(), RegistryError> {
    verify_blocklist::<TabBlocklistEntry>(index_file, public_key_file, key_id, allow_expired)
}

/// Sign `E`'s feed, which must be current.
fn sign_blocklist<E: BlocklistEntry>(
    payload_file: &Path,
    private_key_file: &Path,
    key_id: &str,
) -> Result<Vec<u8>, RegistryError> {
    let label = format!("{} blocklist", E::SUBJECT);
    let value = read_json(payload_file, MAX_BLOCKLIST_BYTES as u64, &label)?;
    let prepared = prepare_blocklist::<E>(&value, false, Utc::now())?;
    sign_prepared_index(prepared.signing, private_key_file, key_id)
}

/// Authenticate a signed `E` feed and validate its domain.
fn verify_blocklist<E: BlocklistEntry>(
    index_file: &Path,
    public_key_file: &Path,
    key_id: &str,
    allow_expired: bool,
) -> Result<(), RegistryError> {
    let signed = verify_blocklist_envelope(
        index_file,
        public_key_file,
        key_id,
        (MAX_BLOCKLIST_BYTES + SIGNED_OVERHEAD_BYTES) as u64,
        &format!("{} blocklist", E::SUBJECT),
    )?;
    prepare_blocklist::<E>(&signed, allow_expired, Utc::now()).map(|_| ())
}

/// The authenticated `signed` payload of a `{signed, signature}` blocklist
/// envelope; the caller validates its domain.
fn verify_blocklist_envelope(
    index_file: &Path,
    public_key_file: &Path,
    key_id: &str,
    limit: u64,
    label: &str,
) -> Result<Value, RegistryError> {
    validate_signing_key_id(key_id)?;
    let envelope = read_json(index_file, limit, &format!("signed {label}"))?;
    let object = envelope
        .as_object()
        .ok_or_else(|| RegistryError::single(format!("{label} envelope must be an object")))?;
    reject_unknown(object, &["signed", "signature"], "envelope")?;
    let signed = object
        .get("signed")
        .ok_or_else(|| RegistryError::single("envelope.signed is required"))?;
    let signature = object.get("signature").and_then(Value::as_object);
    let decoded = validate_signature(signature)?;
    let payload = canonical_json_bytes(signed);
    let validated = ValidatedEnvelope {
        signature: signature.expect("validated signature"),
        decoded,
        payload,
    };
    validate_envelope_key_id(&validated, key_id)?;
    let key = parse_public_key(&read_file(public_key_file, KEY_LIMIT, "public key")?)?;
    verify_validated_signature(validated, &key)?;
    Ok(signed.clone())
}

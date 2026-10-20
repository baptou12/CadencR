use super::*;

pub(super) fn validate_schema_two(value: &Value, errors: &mut Diagnostics) {
    let entry = &value["package"];
    crate::marketplace::validate(entry, "submission.package", errors);
    let content = crate::marketplace::body(entry);
    validate_source(value.get("source"), content, errors);
    if !value
        .get("changelog")
        .and_then(Value::as_str)
        .is_some_and(|s| {
            !ecmascript_trim(s).is_empty() && utf16_len(s) <= 16_384 && !s.contains('\0')
        })
    {
        errors.push("submission.changelog must be a bounded non-empty string".into());
    }
    if crate::marketplace::descriptor(entry).get("repository")
        != value.pointer("/source/repository")
    {
        errors.push("submission package repository must equal source repository".into());
    }
    let kind = crate::marketplace::kind(entry);
    if kind == "provider" {
        validate_marketplace_package(content, errors);
        return;
    }
    let (Some(repository), Some(tag)) = (
        value.pointer("/source/repository").and_then(Value::as_str),
        value.pointer("/source/tag").and_then(Value::as_str),
    ) else {
        return;
    };
    let distribution = crate::marketplace::descriptor(entry).get("distribution");
    if let Some(archive) = distribution
        .and_then(|distribution| distribution.get("archive"))
        .and_then(Value::as_str)
    {
        let label = format!("submission.package.{kind}.distribution");
        validate_archive(archive, repository, tag, &label, errors);
    }
    // Third-party backends: every platform archive is an asset of the same
    // author release as the web archive.
    let binary = distribution
        .and_then(|distribution| distribution.get("binary"))
        .and_then(Value::as_object);
    for (platform, target) in binary.into_iter().flatten() {
        if let Some(archive) = target.get("archive").and_then(Value::as_str) {
            let label = format!("submission.package.{kind}.distribution.binary.{platform}");
            validate_archive(archive, repository, tag, &label, errors);
        }
    }
}

use crate::RegistryError;
use serde_json::{json, Value};

pub(crate) fn create(submission: &Value, repository: &str) -> Result<Value, RegistryError> {
    let entry = &submission["package"];
    if crate::marketplace::kind(entry) == "provider" {
        let mut legacy = submission.clone();
        legacy["schema_version"] = json!(1);
        legacy["package"] = entry["package"].clone();
        let mut plan = crate::create_publication_plan(&legacy, repository)?;
        plan["schema_version"] = json!(2);
        plan["source"]["submission"] = submission.clone();
        plan["mirrored_package"] =
            json!({"kind":"provider","package":plan["mirrored_package"].clone()});
        return Ok(plan);
    }
    let kind = crate::marketplace::kind(entry);
    let (id, version) = crate::marketplace::marketplace_package_identity(entry)
        .ok_or_else(|| RegistryError::single(format!("invalid {kind} identity")))?;
    let distribution = &entry["package"][kind]["distribution"];
    let source_url = distribution["archive"]
        .as_str()
        .ok_or_else(|| RegistryError::single(format!("missing {kind} archive")))?;
    if !source_url.ends_with(".tar.gz") && !source_url.ends_with(".tgz") {
        return Err(RegistryError::single(format!(
            "{kind} archives must be gzip tar archives"
        )));
    }
    let tag = format!("{kind}-{id}-v{version}");
    let release = format!("https://github.com/{repository}/releases/download/{tag}");
    let asset = format!("{kind}.tar.gz");
    let mut mirrored = entry.clone();
    mirrored["package"][kind]["distribution"]["archive"] = json!(format!("{release}/{asset}"));
    mirrored["package"][kind]["distribution"]["repository"] =
        json!(format!("https://github.com/{repository}"));
    let mut targets = vec![json!({"target":kind,"asset":asset,"source_url":source_url,
        "destination_url":format!("{release}/{asset}"),"sha256":distribution["sha256"]})];
    let backend = match kind {
        "tab" => crate::signed_tab_backend(entry)?,
        _ => None,
    };
    // Targets follow platform order.
    for (platform, target) in backend.iter().flat_map(|backend| &backend.targets) {
        let sha256 = &target.sha256;
        let asset = format!("backend-{platform}-{sha256}.tar.gz");
        let destination = format!("{release}/{asset}");
        targets.push(
            json!({"target":crate::tab_backend::plan_target(*platform),"asset":asset,
            "source_url":target.archive,"destination_url":destination,"sha256":sha256}),
        );
        mirrored["package"][kind]["distribution"]["binary"][platform.as_str()]["archive"] =
            json!(destination);
    }
    Ok(json!({
        "schema_version":2,"repository":repository,
        "source":{"submission":submission,"identity":{"provider_id":id,"version":version,
            "repository":submission["source"]["repository"],"commit":submission["source"]["commit"],"tag":submission["source"]["tag"]}},
        "release":{"tag":tag},
        "targets":targets,
        "mirrored_package":mirrored
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mirrored_distribution_preserves_third_party_author_provenance() {
        let submission = json!({"package":{"kind":"theme","package":{"theme":{
            "id":"midnight","version":"1.0.0","repository":"https://github.com/author/themes",
            "distribution":{"archive":"https://github.com/author/themes/releases/download/v1/theme.tar.gz","sha256":"a".repeat(64)}
        }}},"source":{"repository":"author/themes","commit":"abc","tag":"v1"}});
        let plan = create(&submission, "cadencr/registry").unwrap();
        let theme = &plan["mirrored_package"]["package"]["theme"];
        assert_eq!(theme["repository"], "https://github.com/author/themes");
        assert_eq!(
            theme["distribution"]["repository"],
            "https://github.com/cadencr/registry"
        );
        assert_eq!(
            crate::theme_distribution_repository(
                theme["distribution"]["archive"].as_str().unwrap(),
                theme["distribution"].get("repository")
            )
            .unwrap(),
            "https://github.com/cadencr/registry"
        );
    }
}

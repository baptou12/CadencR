//! Custom tab publication uses the same signed, immutable schema-2 envelope.
#[cfg(test)]
mod tests {
    use crate::*;
    use serde_json::{json, Value};

    fn package() -> Value {
        json!({"kind":"tab","package":{
            "tab":{"id":"files-graph","name":"Files graph","description":"Explore changes",
                "version":"1.0.0","repository":"https://github.com/acme/tabs","license":"MIT",
                "api_version":1,"distribution":{
                    "archive":"https://github.com/acme/tabs/releases/download/v1.0.0/tab.tar.gz",
                    "sha256":"a".repeat(64)}},
            "host":{"publisher":"acme","compatibility":{"min_app_version":"0.13.1"}}
        }})
    }

    #[test]
    fn tab_submission_and_mirror_preserve_identity_and_provenance() {
        let entry = package();
        assert!(matches!(
            parse_marketplace_package(&entry).unwrap(),
            MarketplacePackage::Tab(_)
        ));
        assert_eq!(
            marketplace_package_identity(&entry),
            Some(("files-graph", "1.0.0"))
        );
        let submission = json!({"schema_version":2,"package":entry,"source":{
            "repository":"https://github.com/acme/tabs","commit":"b".repeat(40),"tag":"v1.0.0"
        },"changelog":"First custom tab release"});
        validate_submission(&submission).unwrap();
        let plan = create_publication_plan(&submission, "cadencr/registry").unwrap();
        assert_eq!(plan["release"]["tag"], "tab-files-graph-v1.0.0");
        assert_eq!(plan["targets"][0]["target"], "tab");
        assert_eq!(plan["targets"][0]["asset"], "tab.tar.gz");
        assert_eq!(
            plan["mirrored_package"]["package"]["tab"]["repository"],
            "https://github.com/acme/tabs"
        );
        assert_eq!(
            plan["mirrored_package"]["package"]["tab"]["distribution"]["repository"],
            "https://github.com/cadencr/registry"
        );
        validate_marketplace_package(&plan["mirrored_package"]).unwrap();
        let mut wrong_tag = submission;
        wrong_tag["source"]["tag"] = json!("v2.0.0");
        assert!(validate_submission(&wrong_tag).is_err());
    }

    #[test]
    fn tab_contract_rejects_ambiguous_kinds_versions_and_launch_fields() {
        for pointer in [
            "/package/tab/api_version",
            "/package/tab/id",
            "/package/host",
        ] {
            let mut value = package();
            *value.pointer_mut(pointer).unwrap() = Value::Null;
            assert!(parse_marketplace_package(&value).is_err());
        }
        for field in ["cmd", "args", "env", "binary", "targets"] {
            let mut value = package();
            value["package"]["tab"]["distribution"][field] = json!({});
            assert!(validate_marketplace_package(&value).is_err());
        }
        let mut value = package();
        value["kind"] = json!("theme");
        assert!(validate_marketplace_package(&value).is_err());
    }
}

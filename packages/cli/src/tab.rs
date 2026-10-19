use std::path::Path;

use cadencr_plugin_core::tab::{
    describe_all, inspect_tab_folder, TabAccessLevel, TabBackend, TabManifest,
};

use crate::{operation_error, Diagnostic};

const FAILED: &str = "TAB_VALIDATION_FAILED";

/// `cadencr plugin validate <folder> --kind tab`: the same folder inspection the
/// service runs before listing a custom tab. Warnings and an unbuilt entry are
/// reported but never fail the command.
pub(crate) fn validate(
    folder: &Path,
    descriptor: Option<&Path>,
) -> Result<Option<String>, Diagnostic> {
    if descriptor.is_some() {
        return Err(operation_error(
            FAILED,
            "--descriptor is not used for custom tabs",
        ));
    }
    let report = inspect_tab_folder(folder);
    let Some(manifest) = report.valid_manifest() else {
        return Err(operation_error(FAILED, report.findings.describe_errors()));
    };
    let mut message = format!(
        "valid custom tab: {} {} ({}); permissions hash {}",
        manifest.id,
        manifest.version,
        report.directory.display(),
        manifest.permissions_hash()
    );
    message.push_str(&access_note(manifest));
    if !report.entry_present {
        message.push_str(&format!(
            "; note: entry `{}` is not built yet (run `npm run build`)",
            manifest.entry
        ));
    }
    if !report.findings.warnings.is_empty() {
        message.push_str("; warnings: ");
        message.push_str(&describe_all(&report.findings.warnings));
    }
    Ok(Some(message))
}

/// The tab's level, spelled out: what beyond its page it may run.
fn access_note(manifest: &TabManifest) -> String {
    match manifest.access_level() {
        TabAccessLevel::Ui => "; access: page only".into(),
        TabAccessLevel::Commands => {
            let programs: Vec<&str> = manifest
                .commands
                .iter()
                .map(|command| command.program.as_str())
                .collect();
            format!("; access: runs commands ({})", programs.join(", "))
        }
        TabAccessLevel::Backend => {
            let backend = manifest
                .backend
                .as_ref()
                .map_or_else(String::new, TabBackend::command_line);
            format!("; access: native backend `{backend}`, which runs with the user's rights")
        }
    }
}

pub(crate) fn pack(
    request: cadencr_registry_core::PackTabRequest<'_>,
) -> Result<Option<String>, crate::Diagnostic> {
    let archive = cadencr_registry_core::pack_tab(request)
        .map_err(|e| crate::operation_error("TAB_PACKAGING_FAILED", e))?;
    let mut bytes = serde_json::to_vec(&serde_json::json!({"kind":"tab", "archive":archive.archive,"sha256":archive.sha256,"size":archive.size}))
        .map_err(|e| crate::operation_error("TAB_PACKAGING_FAILED", e))?;
    bytes.push(b'\n');
    crate::output::write_stdout(&bytes, &mut std::io::stdout().lock())?;
    Ok(None)
}

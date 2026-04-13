use crate::domain::agents::adapter::RuntimeError;

pub(super) async fn resolve_session_id(
    client: &opencode_sdk_rs::OpenCodeClient,
    directory: &str,
    resume_session_id: Option<String>,
) -> Result<String, RuntimeError> {
    match resume_session_id {
        Some(session_id) => match client.get_session(&session_id, directory).await {
            Ok(_) => Ok(session_id),
            Err(error) if should_create_fresh_session(&error) => client
                .create_session(directory)
                .await
                .map(|session| session.id)
                .map_err(RuntimeError::from),
            Err(error) => Err(RuntimeError::from(error)),
        },
        None => client
            .create_session(directory)
            .await
            .map(|session| session.id)
            .map_err(RuntimeError::from),
    }
}

pub(super) fn should_create_fresh_session(error: &opencode_sdk_rs::SdkError) -> bool {
    matches!(
        error,
        opencode_sdk_rs::SdkError::HttpStatus { status: 404, .. }
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn create_fresh_session_only_on_not_found() {
        assert!(super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::HttpStatus {
                status: 404,
                body: "missing".to_string(),
            }
        ));
        assert!(!super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::HttpStatus {
                status: 500,
                body: "boom".to_string(),
            }
        ));
        assert!(!super::should_create_fresh_session(
            &opencode_sdk_rs::SdkError::Timeout("timed out".to_string())
        ));
    }
}

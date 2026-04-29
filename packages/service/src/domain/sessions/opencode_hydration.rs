use std::collections::HashMap;

use super::models::{AgentMessageRow, AgentSessionRow};
use super::opencode_reparent::reassign_reused_child_message_parents;
use super::opencode_restore::{
    hydrate_opencode_tool_calls_with_children, should_hydrate_opencode_child_sessions,
    should_hydrate_opencode_tool_calls, synthesize_opencode_child_rows,
};

pub(super) async fn hydrate_full_opencode_sessions(
    sessions: &[AgentSessionRow],
    full_messages: &mut HashMap<i64, Vec<AgentMessageRow>>,
) {
    let client = opencode_sdk_rs::OpenCodeClient::new(4096);

    for session in sessions {
        if session.runtime_provider.as_deref() != Some(super::super::agents::opencode::PROVIDER_ID)
        {
            continue;
        }
        let Some(runtime_session_id) = session.runtime_session_id.as_deref() else {
            continue;
        };
        let Some(messages) = full_messages.get_mut(&session.id) else {
            continue;
        };
        let hydrate_tool_calls = should_hydrate_opencode_tool_calls(messages);
        let hydrate_child_sessions = should_hydrate_opencode_child_sessions(messages);
        if !hydrate_tool_calls && !hydrate_child_sessions {
            continue;
        }
        let Ok(provider_messages) = client.list_messages(runtime_session_id).await else {
            continue;
        };
        let child_messages_by_session =
            child_messages_by_session(&client, runtime_session_id).await;
        if hydrate_tool_calls {
            let _ = hydrate_opencode_tool_calls_with_children(
                messages,
                &provider_messages,
                &child_messages_by_session,
            );
        }
        let _ = reassign_reused_child_message_parents(messages);
        if hydrate_child_sessions {
            let synthesized = synthesize_opencode_child_rows(
                messages,
                &provider_messages,
                &child_messages_by_session,
            );
            messages.extend(synthesized);
        }
    }
}

async fn child_messages_by_session(
    client: &opencode_sdk_rs::OpenCodeClient,
    runtime_session_id: &str,
) -> HashMap<String, Vec<opencode_sdk_rs::Message>> {
    let root_directory = client
        .get_session_any(runtime_session_id)
        .await
        .ok()
        .map(|session| session.directory);
    let Ok(children) = client
        .list_children_in_directory(runtime_session_id, root_directory.as_deref())
        .await
    else {
        return HashMap::new();
    };

    let mut child_messages_by_session = HashMap::new();
    for child in children {
        let Ok(child_messages) = client.list_messages(&child.id).await else {
            continue;
        };
        child_messages_by_session.insert(child.id, child_messages);
    }
    child_messages_by_session
}

use std::collections::HashMap;

use futures::stream::{self, StreamExt};

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
    if !sessions.iter().any(|session| {
        session.runtime_provider.as_deref() == Some(super::super::agents::opencode::PROVIDER_ID)
            && session.runtime_session_id.is_some()
            && full_messages
                .get(&session.id)
                .is_some_and(|messages| needs_hydration(messages))
    }) {
        return;
    }

    let client = match opencode_sdk_rs::OpenCodeClient::init().await {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(%error, "skipping OpenCode hydration because the runtime API is unavailable");
            return;
        }
    };

    for session in sessions {
        if session.runtime_provider.as_deref() != Some(super::super::agents::opencode::PROVIDER_ID)
        {
            continue;
        }
        let Some(runtime_session_id) = session.runtime_session_id.as_deref() else {
            tracing::warn!(
                session_id = session.id,
                "skipping OpenCode hydration for session without runtime_session_id"
            );
            continue;
        };
        let Some(messages) = full_messages.get_mut(&session.id) else {
            tracing::warn!(
                session_id = session.id,
                "skipping OpenCode hydration because full messages are missing"
            );
            continue;
        };
        let hydrate_tool_calls = should_hydrate_opencode_tool_calls(messages);
        let hydrate_child_sessions = should_hydrate_opencode_child_sessions(messages);
        if !hydrate_tool_calls && !hydrate_child_sessions {
            continue;
        }
        let provider_messages = match client.list_messages(runtime_session_id).await {
            Ok(messages) => messages,
            Err(error) => {
                tracing::warn!(
                    session_id = session.id,
                    runtime_session_id,
                    %error,
                    "failed to list OpenCode messages for hydration"
                );
                continue;
            }
        };
        let child_messages_by_session =
            child_messages_by_session(&client, runtime_session_id).await;
        if hydrate_tool_calls
            && !hydrate_opencode_tool_calls_with_children(
                messages,
                &provider_messages,
                &child_messages_by_session,
            )
        {
            tracing::debug!(
                session_id = session.id,
                runtime_session_id,
                "OpenCode tool-call hydration made no changes"
            );
        }
        if !reassign_reused_child_message_parents(messages) {
            tracing::debug!(
                session_id = session.id,
                runtime_session_id,
                "OpenCode child message reparenting made no changes"
            );
        }
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

fn needs_hydration(messages: &[AgentMessageRow]) -> bool {
    should_hydrate_opencode_tool_calls(messages) || should_hydrate_opencode_child_sessions(messages)
}

async fn child_messages_by_session(
    client: &opencode_sdk_rs::OpenCodeClient,
    runtime_session_id: &str,
) -> HashMap<String, Vec<opencode_sdk_rs::Message>> {
    let root_directory = match client.get_session_any(runtime_session_id).await {
        Ok(session) => Some(session.directory),
        Err(error) => {
            tracing::warn!(
                runtime_session_id,
                %error,
                "failed to load OpenCode root session while hydrating child messages"
            );
            None
        }
    };
    let children = match client
        .list_children_in_directory(runtime_session_id, root_directory.as_deref())
        .await
    {
        Ok(children) => children,
        Err(error) => {
            tracing::warn!(
                runtime_session_id,
                %error,
                "failed to list OpenCode child sessions for hydration"
            );
            return HashMap::new();
        }
    };

    stream::iter(children)
        .map(|child| {
            let client = client.clone();
            async move {
                match client.list_messages(&child.id).await {
                    Ok(child_messages) => Some((child.id, child_messages)),
                    Err(error) => {
                        tracing::warn!(
                            child_session_id = child.id,
                            %error,
                            "failed to list OpenCode child messages for hydration"
                        );
                        None
                    }
                }
            }
        })
        .buffer_unordered(8)
        .filter_map(std::future::ready)
        .collect()
        .await
}

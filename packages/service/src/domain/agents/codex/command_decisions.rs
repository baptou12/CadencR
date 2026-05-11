use serde_json::Value;

use super::permissions::{DECISION_ACCEPT_FOR_SESSION, DECISION_CANCEL, DECISION_DECLINE};

pub(super) fn synthesized_command_decisions(
    params: &Value,
    supports_allow_future: bool,
) -> Vec<Value> {
    let mut decisions = vec![Value::String("accept".to_string())];
    append_execpolicy_decision(&mut decisions, params);
    append_network_policy_decisions(&mut decisions, params);
    if supports_allow_future {
        decisions.push(Value::String(DECISION_ACCEPT_FOR_SESSION.to_string()));
    }
    decisions.push(Value::String(DECISION_DECLINE.to_string()));
    decisions.push(Value::String(DECISION_CANCEL.to_string()));
    decisions
}

fn append_execpolicy_decision(decisions: &mut Vec<Value>, params: &Value) {
    let Some(amendment) = params
        .get("proposedExecpolicyAmendment")
        .filter(|value| value.as_array().is_some_and(|items| !items.is_empty()))
    else {
        return;
    };
    decisions.push(serde_json::json!({
        "acceptWithExecpolicyAmendment": {
            "execpolicy_amendment": amendment
        }
    }));
}

fn append_network_policy_decisions(decisions: &mut Vec<Value>, params: &Value) {
    let Some(amendments) = params
        .get("proposedNetworkPolicyAmendments")
        .and_then(Value::as_array)
    else {
        return;
    };
    decisions.extend(amendments.iter().map(|amendment| {
        serde_json::json!({
            "applyNetworkPolicyAmendment": {
                "network_policy_amendment": amendment
            }
        })
    }));
}

#[cfg(test)]
mod tests {
    use super::synthesized_command_decisions;
    use serde_json::json;

    #[test]
    fn proposed_execpolicy_adds_similar_command_decision() {
        let decisions = synthesized_command_decisions(
            &json!({ "proposedExecpolicyAmendment": ["cargo", "test"] }),
            true,
        );

        assert!(decisions
            .iter()
            .any(|decision| decision.get("acceptWithExecpolicyAmendment").is_some()));
    }

    #[test]
    fn proposed_network_policy_adds_network_amendment_decision() {
        let decisions = synthesized_command_decisions(
            &json!({
                "proposedNetworkPolicyAmendments": [
                    { "action": "deny", "host": "example.com" }
                ]
            }),
            false,
        );

        assert!(decisions
            .iter()
            .any(|decision| decision.get("applyNetworkPolicyAmendment").is_some()));
    }
}

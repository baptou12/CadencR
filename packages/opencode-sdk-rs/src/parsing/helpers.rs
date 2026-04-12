use serde_json::Value;

pub(super) fn parse_session_status(candidate: &Value) -> crate::types::SessionStatus {
    if let Some(raw) = maybe_string(candidate, &["status"]) {
        return crate::types::SessionStatus::from_str(&raw);
    }
    if let Some(raw) = candidate
        .get("status")
        .and_then(|status| status.get("type"))
        .and_then(Value::as_str)
    {
        return crate::types::SessionStatus::from_str(raw);
    }
    crate::types::SessionStatus::Idle
}

pub(super) fn maybe_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    })
}

pub(super) fn nested_object<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| value.get(*key).filter(|nested| nested.is_object()))
}

pub(super) fn maybe_timestamp(value: &Value, keys: &[&str], path: &[&str]) -> Option<String> {
    maybe_string(value, keys).or_else(|| {
        let nested = value.get(path[0])?.get(path[1])?;
        nested
            .as_i64()
            .or_else(|| nested.as_u64().and_then(|n| i64::try_from(n).ok()))
            .map(|n| n.to_string())
    })
}

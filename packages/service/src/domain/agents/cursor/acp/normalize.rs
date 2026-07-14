use serde_json::Value;

use crate::domain::agents::acp::runtime::tool_input::{normalize_edit_input, rename_key};

pub(super) fn canonical_tool_name(raw: &str) -> String {
    if is_task_title(raw) {
        return "Agent".to_string();
    }
    match raw
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "bash" | "shell" | "terminal" | "shelltoolcall" => "Bash".to_string(),
        "read" | "readfile" | "readtoolcall" => "Read".to_string(),
        "ls" | "list" | "listfiles" => "LS".to_string(),
        "glob" | "findfiles" => "Glob".to_string(),
        "grep" | "search" | "searchfiles" | "searchcode" => "Search".to_string(),
        "write" | "writefile" | "writetoolcall" => "Write".to_string(),
        "edit" | "editfile" | "edittoolcall" => "Edit".to_string(),
        "applypatch" => "ApplyPatch".to_string(),
        "delete" | "deletefile" => "Delete".to_string(),
        "move" | "movefile" | "rename" | "renamefile" => "Move".to_string(),
        "think" => "Think".to_string(),
        "fetch" => "Fetch".to_string(),
        "switchmode" => "SwitchMode".to_string(),
        "websearch" => "WebSearch".to_string(),
        "webfetch" => "WebFetch".to_string(),
        "generateimage" => "GenerateImage".to_string(),
        "todo" | "todowrite" | "updatetodos" => "TodoWrite".to_string(),
        "task" | "agent" => "Agent".to_string(),
        "askquestion" | "askuserquestion" => "AskUserQuestion".to_string(),
        _ => raw.to_string(),
    }
}

fn is_task_title(raw: &str) -> bool {
    raw.split_once(':')
        .is_some_and(|(kind, _)| kind.trim().eq_ignore_ascii_case("task"))
}

pub(super) fn normalize_tool_input(tool_name: &str, input: Value) -> Value {
    let mut input = normalize_edit_input(tool_name, input);
    let Value::Object(ref mut object) = input else {
        return input;
    };
    if tool_name == "Write" {
        rename_key(object, "fileText", "content");
    }
    input
}

#[cfg(test)]
mod tests {
    use super::{canonical_tool_name, normalize_tool_input};
    use serde_json::json;

    #[test]
    fn canonicalizes_cursor_tool_names() {
        assert_eq!(canonical_tool_name("shellToolCall"), "Bash");
        assert_eq!(canonical_tool_name("write_file"), "Write");
        assert_eq!(canonical_tool_name("grep"), "Search");
        assert_eq!(canonical_tool_name("search_files"), "Search");
        assert_eq!(canonical_tool_name("rename_file"), "Move");
        assert_eq!(canonical_tool_name("switch_mode"), "SwitchMode");
        assert_eq!(canonical_tool_name("Task: Subagent task"), "Agent");
        assert_eq!(
            canonical_tool_name("mcp__tools__search"),
            "mcp__tools__search"
        );
    }

    #[test]
    fn normalizes_cursor_write_and_edit_inputs() {
        assert_eq!(
            normalize_tool_input("Write", json!({ "path": "a.rs", "fileText": "x" })),
            json!({ "file_path": "a.rs", "content": "x" })
        );
        assert_eq!(
            normalize_tool_input(
                "Edit",
                json!({ "filePath": "a.rs", "oldText": "a", "newText": "b" })
            ),
            json!({ "file_path": "a.rs", "old_string": "a", "new_string": "b" })
        );
    }
}

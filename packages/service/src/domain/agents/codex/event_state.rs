use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub(super) struct IndexState {
    next: u64,
    by_id: HashMap<String, u64>,
    canonical_by_id: HashMap<String, String>,
    results: HashSet<String>,
    command_action_items: HashSet<String>,
    delayed_command_items: HashSet<String>,
    suppressed_raw_tool_items: HashSet<String>,
}

impl IndexState {
    pub(super) fn reset(&mut self) {
        self.next = 0;
        self.by_id.clear();
        self.canonical_by_id.clear();
        self.results.clear();
        self.command_action_items.clear();
        self.delayed_command_items.clear();
        self.suppressed_raw_tool_items.clear();
    }

    pub(super) fn has_index(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }

    pub(super) fn index_for(&mut self, id: &str) -> u64 {
        if let Some(index) = self.by_id.get(id) {
            return *index;
        }
        let index = self.next + 1;
        self.next = index;
        self.by_id.insert(id.to_string(), index);
        self.canonical_by_id
            .entry(id.to_string())
            .or_insert_with(|| id.to_string());
        index
    }

    pub(super) fn alias_index(&mut self, id: &str, canonical_id: &str, index: u64) {
        self.by_id.entry(id.to_string()).or_insert(index);
        self.canonical_by_id
            .entry(id.to_string())
            .or_insert_with(|| canonical_id.to_string());
    }

    pub(super) fn canonical_id(&self, id: &str) -> String {
        self.canonical_by_id
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.to_string())
    }

    pub(super) fn record_result(&mut self, id: &str) -> bool {
        self.results.insert(self.canonical_id(id))
    }

    pub(super) fn record_command_action_item(&mut self, id: &str) {
        self.command_action_items.insert(id.to_string());
    }

    pub(super) fn has_command_action_item(&self, id: &str) -> bool {
        self.command_action_items.contains(id)
    }

    pub(super) fn record_delayed_command_item(&mut self, id: &str) {
        self.delayed_command_items.insert(id.to_string());
    }

    pub(super) fn has_delayed_command_item(&self, id: &str) -> bool {
        self.delayed_command_items.contains(id)
    }

    pub(super) fn record_suppressed_raw_tool_item(&mut self, id: &str) {
        self.suppressed_raw_tool_items.insert(id.to_string());
    }

    pub(super) fn has_suppressed_raw_tool_item(&self, id: &str) -> bool {
        self.suppressed_raw_tool_items.contains(id)
    }
}

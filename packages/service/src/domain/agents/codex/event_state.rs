use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub(super) struct IndexState {
    next: u64,
    by_id: HashMap<String, u64>,
    canonical_by_id: HashMap<String, String>,
    results: HashSet<String>,
}

impl IndexState {
    pub(super) fn reset(&mut self) {
        self.next = 0;
        self.by_id.clear();
        self.canonical_by_id.clear();
        self.results.clear();
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
}

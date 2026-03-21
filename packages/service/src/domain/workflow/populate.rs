use std::collections::{HashMap, HashSet, VecDeque};

/// Result of topological sort: (node_id, group_index) pairs ordered topologically.
/// group_index represents the depth in the dependency graph (longest path from any root).
pub fn topological_sort(
    nodes: &[i64],
    edges: &[(i64, i64)], // (from, to) meaning "from" must complete before "to"
) -> Result<Vec<(i64, usize)>, String> {
    let node_set: HashSet<i64> = nodes.iter().copied().collect();

    // Build adjacency list and in-degree map
    let mut adj: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut in_degree: HashMap<i64, usize> = HashMap::new();
    // Reverse adjacency for depth calculation
    let mut rev_adj: HashMap<i64, Vec<i64>> = HashMap::new();

    for &node in nodes {
        adj.entry(node).or_default();
        in_degree.entry(node).or_insert(0);
        rev_adj.entry(node).or_default();
    }

    for &(from, to) in edges {
        if !node_set.contains(&from) || !node_set.contains(&to) {
            return Err(format!(
                "Edge references unknown node: ({from}, {to})"
            ));
        }
        adj.entry(from).or_default().push(to);
        rev_adj.entry(to).or_default().push(from);
        *in_degree.entry(to).or_insert(0) += 1;
    }

    // Kahn's algorithm
    let mut queue: VecDeque<i64> = VecDeque::new();
    for &node in nodes {
        if in_degree[&node] == 0 {
            queue.push_back(node);
        }
    }

    let mut order: Vec<i64> = Vec::new();
    while let Some(node) = queue.pop_front() {
        order.push(node);
        for &next in adj.get(&node).unwrap_or(&vec![]) {
            let deg = in_degree.get_mut(&next).unwrap();
            *deg -= 1;
            if *deg == 0 {
                queue.push_back(next);
            }
        }
    }

    if order.len() != nodes.len() {
        return Err("Cycle detected in dependency graph".to_string());
    }

    // Compute group_index as longest path from any root to each node
    let mut depth: HashMap<i64, usize> = HashMap::new();
    for &node in &order {
        let max_parent = rev_adj
            .get(&node)
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|p| depth.get(p))
            .max()
            .copied()
            .map(|d| d + 1)
            .unwrap_or(0);
        depth.insert(node, max_parent);
    }

    Ok(order
        .into_iter()
        .map(|id| (id, depth[&id]))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_chain() {
        // A -> B -> C
        let nodes = vec![1, 2, 3];
        let edges = vec![(1, 2), (2, 3)];
        let result = topological_sort(&nodes, &edges).unwrap();
        assert_eq!(result, vec![(1, 0), (2, 1), (3, 2)]);
    }

    #[test]
    fn test_diamond() {
        // A -> B, A -> C, B -> D, C -> D
        let nodes = vec![1, 2, 3, 4];
        let edges = vec![(1, 2), (1, 3), (2, 4), (3, 4)];
        let result = topological_sort(&nodes, &edges).unwrap();

        // Check group indices
        let groups: HashMap<i64, usize> = result.iter().copied().collect();
        assert_eq!(groups[&1], 0);
        assert_eq!(groups[&2], 1);
        assert_eq!(groups[&3], 1);
        assert_eq!(groups[&4], 2);

        // Check ordering: 1 before 2,3; 2,3 before 4
        let pos: HashMap<i64, usize> = result.iter().enumerate().map(|(i, &(id, _))| (id, i)).collect();
        assert!(pos[&1] < pos[&2]);
        assert!(pos[&1] < pos[&3]);
        assert!(pos[&2] < pos[&4]);
        assert!(pos[&3] < pos[&4]);
    }

    #[test]
    fn test_cycle_detection() {
        let nodes = vec![1, 2, 3];
        let edges = vec![(1, 2), (2, 3), (3, 1)];
        let result = topological_sort(&nodes, &edges);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cycle"));
    }

    #[test]
    fn test_no_dependencies() {
        let nodes = vec![1, 2, 3];
        let edges = vec![];
        let result = topological_sort(&nodes, &edges).unwrap();
        assert_eq!(result.len(), 3);
        // All at group 0
        for &(_, group) in &result {
            assert_eq!(group, 0);
        }
    }

    #[test]
    fn test_empty() {
        let result = topological_sort(&[], &[]).unwrap();
        assert!(result.is_empty());
    }
}

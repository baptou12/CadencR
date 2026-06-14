use std::collections::HashMap;
use std::sync::Arc;

use super::service::{PtyHandle, PtyManager};

pub fn is_foreground_command_active(shell_pgrp: Option<i32>, foreground_pgrp: Option<i32>) -> bool {
    match (shell_pgrp, foreground_pgrp) {
        (Some(shell), Some(foreground)) => foreground > 0 && shell != foreground,
        _ => false,
    }
}

pub fn foreground_command_counts_by_feature(manager: &PtyManager) -> HashMap<i64, i64> {
    let mut counts = HashMap::new();
    for entry in manager.terminals.iter() {
        let handle = entry.value();
        if handle.alive.borrow().is_some() {
            continue;
        }
        let foreground = foreground_process_group(Arc::clone(handle));
        if is_foreground_command_active(handle.shell_process_group_leader, foreground) {
            *counts.entry(handle.feature_id).or_insert(0) += 1;
        }
    }
    counts
}

fn foreground_process_group(handle: Arc<PtyHandle>) -> Option<i32> {
    #[cfg(unix)]
    {
        let master = handle.master.lock().unwrap_or_else(|e| e.into_inner());
        let fd = master.as_raw_fd()?;
        let pgrp = unsafe { libc::tcgetpgrp(fd) };
        return (pgrp > 0).then_some(pgrp);
    }
    #[cfg(not(unix))]
    {
        let _ = handle;
        None
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn foreground_differs_from_shell_counts_as_busy() {
        assert!(super::is_foreground_command_active(Some(12), Some(34)));
        assert!(!super::is_foreground_command_active(Some(12), Some(12)));
        assert!(!super::is_foreground_command_active(None, Some(12)));
        assert!(!super::is_foreground_command_active(Some(12), None));
    }
}

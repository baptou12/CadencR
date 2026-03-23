use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::watch;
use tracing::info;

const SCROLLBACK_CAP: usize = 50 * 1024; // 50KB

/// Ring buffer that keeps the last ~50KB of terminal output.
pub struct ScrollbackBuffer {
    buf: VecDeque<u8>,
}

impl ScrollbackBuffer {
    fn new() -> Self {
        Self {
            buf: VecDeque::with_capacity(SCROLLBACK_CAP),
        }
    }

    pub fn append(&mut self, data: &[u8]) {
        let overflow = (self.buf.len() + data.len()).saturating_sub(SCROLLBACK_CAP);
        if overflow > 0 {
            self.buf.drain(..overflow);
        }
        self.buf.extend(data);
    }

    pub fn contents(&self) -> String {
        let (a, b) = self.buf.as_slices();
        let mut v = Vec::with_capacity(a.len() + b.len());
        v.extend_from_slice(a);
        v.extend_from_slice(b);
        String::from_utf8_lossy(&v).into_owned()
    }
}

/// Handle for a single PTY session.
pub struct PtyHandle {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub master_writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master_reader: Arc<Mutex<Box<dyn Read + Send>>>,
    pub scrollback: Arc<Mutex<ScrollbackBuffer>>,
    pub alive: Arc<watch::Sender<bool>>,
    pub child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
}

/// Manages all PTY sessions. Stored in AppState.
#[derive(Clone)]
pub struct PtyManager {
    pub terminals: Arc<DashMap<String, Arc<PtyHandle>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(DashMap::new()),
        }
    }

    /// Spawn a new PTY in the given working directory. Returns (pty_id, handle).
    pub fn create_pty(&self, cwd: &str) -> anyhow::Result<(String, Arc<PtyHandle>)> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell = detect_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let pty_id = uuid::Uuid::new_v4().to_string();
        let (alive_tx, _) = watch::channel(true);

        let handle = Arc::new(PtyHandle {
            master: Arc::new(Mutex::new(pair.master)),
            master_writer: Arc::new(Mutex::new(writer)),
            master_reader: Arc::new(Mutex::new(reader)),
            scrollback: Arc::new(Mutex::new(ScrollbackBuffer::new())),
            alive: Arc::new(alive_tx),
            child: Arc::new(Mutex::new(child)),
        });

        self.terminals.insert(pty_id.clone(), Arc::clone(&handle));

        let terminals = Arc::clone(&self.terminals);
        let alive_tx = Arc::clone(&handle.alive);
        let child_ref = Arc::clone(&handle.child);
        let pid = pty_id.clone();
        tokio::task::spawn_blocking(move || {
            let _status = child_ref.lock().expect("child lock").wait();
            info!(pty_id = %pid, "PTY child exited");
            let _ = alive_tx.send(false);

            // Keep scrollback for 5 minutes, then remove
            std::thread::sleep(std::time::Duration::from_secs(300));
            terminals.remove(&pid);
            info!(pty_id = %pid, "PTY handle removed after grace period");
        });

        Ok((pty_id, handle))
    }

    pub fn write_pty(&self, pty_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let handle = self
            .terminals
            .get(pty_id)
            .ok_or_else(|| anyhow::anyhow!("PTY not found: {pty_id}"))?;
        handle
            .master_writer
            .lock()
            .expect("writer lock")
            .write_all(data)?;
        Ok(())
    }

    pub fn resize_pty(&self, pty_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let handle = self
            .terminals
            .get(pty_id)
            .ok_or_else(|| anyhow::anyhow!("PTY not found: {pty_id}"))?;
        handle
            .master
            .lock()
            .expect("master lock")
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow::anyhow!("Failed to resize PTY: {e}"))?;
        Ok(())
    }

    pub fn kill_pty(&self, pty_id: &str) -> anyhow::Result<()> {
        let handle = self
            .terminals
            .get(pty_id)
            .ok_or_else(|| anyhow::anyhow!("PTY not found: {pty_id}"))?;
        handle
            .child
            .lock()
            .expect("child lock")
            .kill()
            .map_err(|e| anyhow::anyhow!("Failed to kill PTY: {e}"))?;
        Ok(())
    }

    pub fn get_scrollback(&self, pty_id: &str) -> Option<(bool, String)> {
        let handle = self.terminals.get(pty_id)?;
        let alive = *handle.alive.borrow();
        let scrollback = handle.scrollback.lock().expect("scrollback lock").contents();
        Some((alive, scrollback))
    }
}

fn detect_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

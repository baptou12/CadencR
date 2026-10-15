//! Run a one-shot command with a hard timeout and a bounded output capture, so
//! a hung or chatty program can neither stall nor flood the service.

use std::process::Output;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

/// Failure fragment; callers prefix it with the command they ran, e.g.
/// "provider model discovery " + "timed out after 10 seconds".
#[derive(Debug, Clone)]
pub struct BoundedCommandError(String);

impl BoundedCommandError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl std::fmt::Display for BoundedCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for BoundedCommandError {}

/// Spawn `command` (stdout and stderr must be piped) and collect its output.
/// The child is killed on timeout or when either stream exceeds 1 MiB.
pub async fn capture_bounded(
    mut command: tokio::process::Command,
    timeout: Duration,
) -> Result<Output, BoundedCommandError> {
    let mut child = command
        .spawn()
        .map_err(|error| BoundedCommandError::new(format!("could not start: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| BoundedCommandError::new("stdout was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| BoundedCommandError::new("stderr was unavailable"))?;
    let mut stdout_task = tokio::spawn(read_bounded(stdout));
    let mut stderr_task = tokio::spawn(read_bounded(stderr));

    let capture = async {
        let wait = async {
            child
                .wait()
                .await
                .map_err(|error| BoundedCommandError::new(format!("failed to wait: {error}")))
        };
        let stdout = async {
            (&mut stdout_task).await.map_err(|error| {
                BoundedCommandError::new(format!("stdout reader failed: {error}"))
            })?
        };
        let stderr = async {
            (&mut stderr_task).await.map_err(|error| {
                BoundedCommandError::new(format!("stderr reader failed: {error}"))
            })?
        };
        tokio::try_join!(wait, stdout, stderr)
    };
    let error = match tokio::time::timeout(timeout, capture).await {
        Ok(Ok((status, stdout, stderr))) => {
            return Ok(Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok(Err(error)) => error,
        Err(_) => {
            BoundedCommandError::new(format!("timed out after {} seconds", timeout.as_secs()))
        }
    };
    // The child may already have exited; the error being reported is the one
    // that matters.
    let _ = child.kill().await;
    stdout_task.abort();
    stderr_task.abort();
    Err(error)
}

async fn read_bounded(mut reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, BoundedCommandError> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|error| BoundedCommandError::new(format!("could not read output: {error}")))?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) > MAX_OUTPUT_BYTES {
            return Err(BoundedCommandError::new(format!(
                "output exceeded {MAX_OUTPUT_BYTES} bytes"
            )));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{capture_bounded, read_bounded, MAX_OUTPUT_BYTES};
    use std::process::Stdio;
    use std::time::Duration;

    #[tokio::test]
    async fn bounded_reader_rejects_output_immediately_after_the_limit() {
        let bytes = vec![b'x'; MAX_OUTPUT_BYTES + 1];
        let error = read_bounded(std::io::Cursor::new(bytes)).await.unwrap_err();
        assert!(error.to_string().contains("exceeded"));
    }

    #[tokio::test]
    async fn captures_both_streams_and_times_out() {
        let mut command = tokio::process::Command::new("/bin/sh");
        command
            .args(["-c", "echo out; echo err >&2"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = capture_bounded(command, Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!(output.stdout, b"out\n");
        assert_eq!(output.stderr, b"err\n");

        let mut slow = tokio::process::Command::new("/bin/sh");
        slow.args(["-c", "sleep 5"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let error = capture_bounded(slow, Duration::from_millis(100))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("timed out"));
    }
}

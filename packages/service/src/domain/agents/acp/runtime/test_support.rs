use serde_json::{json, Value};
use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

use crate::domain::agents::acp::{AcpClient, AcpClientInfo};

pub(crate) async fn build_in_memory_client() -> (AcpClient, DuplexStream, BufReader<DuplexStream>) {
    let (client_stdout, agent_stdout) = duplex(64 * 1024);
    let (agent_stdin, client_stdin) = duplex(64 * 1024);
    let client = AcpClient::spawn_with_streams(
        Box::new(client_stdin),
        client_stdout,
        tokio::io::empty(),
        AcpClientInfo::default(),
    )
    .await
    .expect("in-memory ACP client should spawn");
    (client, agent_stdout, BufReader::new(agent_stdin))
}

pub(crate) async fn read_request(reader: &mut BufReader<DuplexStream>) -> Value {
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .expect("ACP request frame should be readable");
    serde_json::from_str(line.trim()).expect("ACP request frame should be JSON")
}

pub(crate) async fn send_response(stdout: &mut DuplexStream, id: Value, result: Value) {
    let mut frame = serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "result": result }))
        .expect("ACP response should serialize");
    frame.push(b'\n');
    stdout
        .write_all(&frame)
        .await
        .expect("ACP response frame should write");
}

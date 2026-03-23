use serde::{Deserialize, Serialize};

/// Messages sent from the client to the server over the terminal WebSocket.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientMessage {
    Write { data: String },
    Resize { cols: u16, rows: u16 },
    Kill,
}

/// Messages sent from the server to the client over the terminal WebSocket.
#[derive(Debug, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ServerMessage {
    Data { data: String },
    Exit { code: i32 },
    Ready { pty_id: String },
    Reconnected { scrollback: String, alive: bool },
    Error { message: String },
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("ServerMessage serialization should not fail")
    }
}

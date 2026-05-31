//! Typed representations of every message the Claude Code CLI can emit.
//!
//! The module is split by responsibility:
//! - [`events`] — streaming event bodies and the `system`/usage/assistant types.
//! - [`sdk_message`] — the public [`SdkMessage`] tagged-union and its helpers.
//! - [`deserialize`] — the custom forward-compatible deserializer for `SdkMessage`.

mod deserialize;
mod events;
mod sdk_message;

pub use events::{
    AssistantMessageBody, MessageDeltaBody, MessageStartBody, ModelUsageInfo, StreamEventData,
    SystemMessage,
};
pub use sdk_message::SdkMessage;

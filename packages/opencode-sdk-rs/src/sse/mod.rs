//! OpenCode SSE transport.
//!
//! Split into four modules:
//! - `stream`: thin wrapper around one `reqwest_eventsource::EventSource`.
//! - `dispatcher`: shared per-(server, directory) fan-out hub. Holds
//!   subscribers, the reconcile state, and the lifecycle bus.
//! - `runner`: the reconnect loop with watchdog, backoff, and the
//!   smoking-gun fix that drops subscriber senders on every disconnect so
//!   the service adapter can auto-resubscribe (see plan finding #1).
//! - `lifecycle`: typed health/transition events (`DispatcherStatus`)
//!   broadcast to service-side consumers so the UI never sits silently
//!   on a stalled stream.

mod dispatcher;
mod lifecycle;
mod runner;
mod stream;

pub use dispatcher::{shared_dispatcher, SseDispatcher};
pub use lifecycle::DispatcherStatus;
pub use stream::SseStream;

# cadencr-tab-backend

Write the native backend of a [Cadencr](https://github.com/merkr-software/CadencR)
custom tab in Rust.

A custom tab may ship a native executable that Cadencr starts per
conversation and talks to over stdin/stdout, one JSON object per line. The
protocol is the contract — [`docs/TAB_BACKEND_PROTOCOL.md`][protocol] — and
any language that produces a native binary can implement it. This crate is
the reference helper: it does the handshake, framing, concurrency and error
handling, so a backend is one function.

## Quick start

```toml
[dependencies]
cadencr-tab-backend = "0.1"
serde_json = "1"
```

```rust,no_run
use std::process::ExitCode;

use cadencr_tab_backend::{serve, Context, Error};
use serde_json::{json, Value};

fn handle(cx: &Context) -> Result<Value, Error> {
    match cx.method() {
        "greet" => {
            let name: String = cx.params()?;
            Ok(json!(format!("hello, {name}")))
        }
        other => Err(Error::unknown_method(other)),
    }
}

fn main() -> ExitCode {
    serve(handle)
}
```

Build it for every platform the tab supports and point the manifest at the
binaries (paths inside the tab folder):

```json
"backend": {
  "reasoning": "Reads the project's build logs",
  "protocol": 1,
  "binary": {
    "darwin-aarch64": "bin/darwin-aarch64/my-backend",
    "darwin-x86_64": "bin/darwin-x86_64/my-backend",
    "linux-x86_64": "bin/linux-x86_64/my-backend"
  }
}
```

The tab's web UI then calls it with `backend.request(method, params)`.

## What `serve` does

- reads the `hello` line and refuses (stderr message, exit status 1) a host
  that speaks another protocol version;
- answers `ready`;
- runs requests on a worker pool (8 by default, `serve_with(Config::builder().workers(n).build(), …)`):
  a slow request does not hold up the others, and responses may be written
  out of order;
- turns a handler error into an error response and a panic into an
  `INTERNAL_ERROR` response;
- logs malformed lines to stderr and skips them (a request-shaped line with an
  id but no method is answered with `INVALID_REQUEST`);
- returns `ExitCode::SUCCESS` when stdin closes;
- on Unix, reserves stdin and stdout for the protocol: descriptor 1 is moved
  to a private descriptor and pointed at stderr, so a stray `println!` (yours,
  a dependency's, or a child process's, even one still buffered when `serve`
  starts) ends up in the log instead of breaking the protocol; descriptor 0
  is moved to a private descriptor and pointed at `/dev/null`, so a child
  process you spawn can never read the host's requests. Call `serve` before
  reading stdin yourself.

stderr is the backend's log: Cadencr keeps its last lines and shows them in
the tab's Activity.

## Features

| Feature | Adds |
|---|---|
| `api` | `Context::api()`: a blocking client for the Cadencr API with the backend's own scoped token, decoding Cadencr's `{error, code}` errors. It never uses a proxy (`HTTP_PROXY`/`ALL_PROXY` are ignored) and refuses a `base_url` that is not `http://` to a loopback address, so the token only reaches Cadencr |
| `conformance` | `conformance::run(binary, &Options::default())`: checks any backend binary (in any language) against the protocol, spawned the way the host spawns it (no `CADENCR_*`/`VITE_*` variables, own process group killed at the end); `Options::builder().protocol(n)` for a tab declaring protocol `n` |

`testing::TestHost` drives a handler in-process, without spawning a process:

```rust,ignore
let host = cadencr_tab_backend::testing::TestHost::new(handle);
assert_eq!(host.call("greet", serde_json::json!("Ada")), Ok(serde_json::json!("hello, Ada")));
```

See [`examples/echo.rs`](examples/echo.rs) for a complete backend.

## Versioning

The crate is versioned independently of the Cadencr app. It speaks protocol
version 1.

## License

Apache-2.0

[protocol]: https://github.com/merkr-software/CadencR/blob/main/docs/TAB_BACKEND_PROTOCOL.md

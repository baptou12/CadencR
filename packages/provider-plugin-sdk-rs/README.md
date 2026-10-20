# cadencr-provider-sdk

Command harness for code-backed [Cadencr](https://github.com/merkr-software/CadencR)
agent provider packages.

A provider package is a native executable that Cadencr runs to talk to an
agent over [ACP](https://agentclientprotocol.com) v1. This crate implements the
executable's command contract — `models`, `run`, `version`, and the optional
`updates` / `update` — so a connector only implements the
`CadencrProvider` trait.

```toml
[dependencies]
cadencr-provider-sdk = "0.1"
```

```rust,no_run
use std::ffi::OsString;
use std::path::Path;
use std::process::ExitCode;

use agent_client_protocol::schema::v1::SessionConfigOption;
use cadencr_provider_sdk::{run_cli, CadencrProvider, ProviderError};

struct MyProvider;

impl CadencrProvider for MyProvider {
    fn models(
        &self,
        _cwd: &Path,
        _provider_args: &[OsString],
    ) -> Result<Vec<SessionConfigOption>, ProviderError> {
        Ok(Vec::new())
    }

    fn run_acp(&self, _provider_args: &[OsString]) -> Result<ExitCode, ProviderError> {
        // Speak ACP v1 on stdin/stdout until stdin closes.
        Ok(ExitCode::SUCCESS)
    }

    fn version(&self) -> &str {
        env!("CARGO_PKG_VERSION")
    }
}

fn main() -> ExitCode {
    run_cli(&MyProvider)
}
```

| Command | Contract |
|---|---|
| `models --format acp-config-options-v1 --cwd <absolute-path> [args…]` | prints the model selector as a JSON array of ACP `SessionConfigOption` |
| `run --protocol acp-v1 [args…]` | speaks ACP v1 over stdio |
| `version` | prints the connector version |
| `updates --format cadencr-updates-v1` | prints an update report (optional) |
| `update [--version <v>]` | installs a version (optional) |

The contract is language-neutral: any executable implementing it works, and
this crate is only the reference path. The normative specification is
[`docs/PROVIDER_SPEC/PROVIDER_PACKAGE.md`](https://github.com/merkr-software/CadencR/blob/main/docs/PROVIDER_SPEC/PROVIDER_PACKAGE.md).

The crate is versioned independently of the Cadencr app.

## License

Apache-2.0

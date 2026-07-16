/// How a provider handles a user-authored `!` shell command.
///
/// The strategy belongs to the adapter so shared prompt routing never branches
/// on a provider id. New providers must explicitly choose native support,
/// Cadencr-managed execution, or no support.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeUserShellStrategy {
    /// Dispatch through the provider's programmatic user-shell API. The
    /// provider owns execution, transcript events, and context insertion.
    ProviderNative,
    /// Execute in Cadencr's worktree terminal environment, render immediately,
    /// then attach the command record to the next ordinary prompt.
    CadencrManaged,
    /// The provider intentionally exposes neither strategy.
    Unsupported,
}

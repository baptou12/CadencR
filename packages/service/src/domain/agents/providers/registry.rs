//! Runtime provider registry.
//!
//! The set of runtime providers used to be a compile-time
//! `&[(&str, &dyn AgentRuntimeAdapter)]` slice, which forced every entry to be
//! a `'static` literal. This module keeps the exact same built-in providers, in
//! the exact same order, behind a registry that is *constructed* at runtime, so
//! a later increment can add installed (marketplace) providers without changing
//! the shape of any lookup site.
//!
//! See `docs/PROVIDER_SPEC/BOUNDARIES.md` (Phase 1). Only the registration
//! mechanism is runtime here; nothing is user-installable yet.

use std::borrow::Cow;
use std::ops::Deref;
use std::sync::{Arc, OnceLock};

use crate::domain::agents::adapter::AgentRuntimeAdapter;

/// A cloneable, `'static` handle to a registered adapter.
///
/// `Borrowed` exists for exactly one reason: `spawn_startup_warmup(&self)` can't
/// move `self` into a `'static` task, so Claude Code's warmup
/// (`claude_code/adapter_impl.rs`) populates the `CLAUDE_CODE_ADAPTER` static
/// directly. Its probe caches live inline in the adapter value, so a
/// registry-owned copy would read a different cache than the warmup fills.
/// `Owned` covers adapters the registry constructs — today the stateless
/// built-ins, tomorrow adapters built from an installation record. Collapsing
/// to a single `Arc` becomes possible once warmup takes `self: Arc<Self>`.
///
/// Both variants own their target for `'static`, so a handle can be stored on a
/// spawned task exactly like the old `&'static` reference could.
#[derive(Clone)]
pub enum ProviderAdapterHandle {
    Borrowed(&'static (dyn AgentRuntimeAdapter + 'static)),
    Owned(Arc<dyn AgentRuntimeAdapter>),
}

impl ProviderAdapterHandle {
    /// Hand back an adapter that must remain the one shared instance.
    pub fn borrowed(adapter: &'static (dyn AgentRuntimeAdapter + 'static)) -> Self {
        Self::Borrowed(adapter)
    }

    /// Register an adapter value the registry owns.
    pub fn owned(adapter: impl AgentRuntimeAdapter + 'static) -> Self {
        Self::Owned(Arc::new(adapter))
    }

    /// Borrow the adapter behind this handle. Callers making a single
    /// dispatched call can rely on `Deref` instead.
    pub fn as_adapter(&self) -> &(dyn AgentRuntimeAdapter + 'static) {
        match self {
            Self::Borrowed(adapter) => *adapter,
            Self::Owned(adapter) => adapter.as_ref(),
        }
    }
}

impl Deref for ProviderAdapterHandle {
    type Target = dyn AgentRuntimeAdapter + 'static;

    fn deref(&self) -> &Self::Target {
        self.as_adapter()
    }
}

impl std::fmt::Debug for ProviderAdapterHandle {
    /// Prints the variant only. `catalog_entry()` builds a whole
    /// `ProviderCatalogEntry` (Claude Code's includes a fallback model list),
    /// so resolving the provider id here would make every `?registry` log line
    /// allocate one catalog per provider. `RegisteredProvider` carries the id.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Borrowed(_) => "ProviderAdapterHandle::Borrowed",
            Self::Owned(_) => "ProviderAdapterHandle::Owned",
        })
    }
}

/// Constructs a registered adapter. Built-ins hand back their shared `static`
/// or build a fresh value; a future installed-provider factory will build an
/// `Owned` handle from a validated installation record.
type ProviderAdapterFactory = fn() -> ProviderAdapterHandle;

/// One entry in the registry: the catalog id plus the adapter that owns it.
#[derive(Clone, Debug)]
pub struct RegisteredProvider {
    id: Cow<'static, str>,
    adapter: ProviderAdapterHandle,
}

impl RegisteredProvider {
    pub fn new(id: impl Into<Cow<'static, str>>, adapter: ProviderAdapterHandle) -> Self {
        Self {
            id: id.into(),
            adapter,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn adapter(&self) -> &ProviderAdapterHandle {
        &self.adapter
    }
}

/// The compiled-in providers, in catalog order. Registration order is
/// user-visible — it drives the provider picker and the catalog response — so
/// this list stays ordered and the registry never sorts it.
///
/// Adding a built-in provider is still one edit here.
static BUILTIN_PROVIDERS: &[(&str, ProviderAdapterFactory)] = &[
    // Claude Code caches its model catalog and slash commands *inside* the
    // adapter value, so every caller must see the same instance.
    (super::super::claude_code::PROVIDER_ID, || {
        ProviderAdapterHandle::borrowed(&super::super::claude_code::CLAUDE_CODE_ADAPTER)
    }),
    // The remaining built-ins hold no inline state (their caches are
    // module-level), so the registry constructs them the same way it will
    // construct an installed provider.
    (super::super::codex::PROVIDER_ID, || {
        ProviderAdapterHandle::owned(super::super::codex::CodexAdapter)
    }),
    (super::super::cursor::PROVIDER_ID, || {
        ProviderAdapterHandle::owned(super::super::cursor::CursorAdapter)
    }),
    (super::super::opencode::PROVIDER_ID, || {
        ProviderAdapterHandle::owned(super::super::opencode::OpenCodeAdapter)
    }),
];

/// Ordered set of runtime providers available to this process.
#[derive(Clone, Debug, Default)]
pub struct ProviderRegistry {
    providers: Vec<RegisteredProvider>,
}

impl ProviderRegistry {
    /// Build a registry from an ordered list of entries. A duplicate of an
    /// already-registered id is ignored, so the first registration (built-ins)
    /// keeps ownership of its catalog id.
    pub fn from_providers(providers: impl IntoIterator<Item = RegisteredProvider>) -> Self {
        let mut registered: Vec<RegisteredProvider> = Vec::new();
        for provider in providers {
            let adapter_id = provider.adapter().catalog_entry().id;
            if adapter_id != provider.id() {
                tracing::warn!(
                    provider_id = provider.id(),
                    adapter_provider_id = adapter_id,
                    "provider registration ignored because its id does not match its adapter catalog id"
                );
                continue;
            }
            if registered
                .iter()
                .any(|existing| existing.id() == provider.id())
            {
                // Unreachable for built-ins (each id is its adapter's
                // `PROVIDER_ID` const) but reachable once providers are
                // installable, so dropping the later duplicate keeps the first
                // registration's ownership of the id.
                tracing::warn!(
                    provider_id = provider.id(),
                    "duplicate provider registration ignored"
                );
                continue;
            }
            registered.push(provider);
        }
        Self {
            providers: registered,
        }
    }

    /// The registry as it exists today: built-in providers only.
    pub fn with_builtins() -> Self {
        Self::from_providers(
            BUILTIN_PROVIDERS
                .iter()
                .map(|(id, factory)| RegisteredProvider::new(*id, factory())),
        )
    }

    pub fn adapter(&self, provider_id: &str) -> Option<ProviderAdapterHandle> {
        self.iter()
            .find(|provider| provider.id() == provider_id)
            .map(|provider| provider.adapter().clone())
    }

    pub fn contains(&self, provider_id: &str) -> bool {
        self.iter().any(|provider| provider.id() == provider_id)
    }

    /// Registered providers in catalog order.
    pub fn iter(&self) -> impl Iterator<Item = &RegisteredProvider> {
        self.providers.iter()
    }

    /// Registered adapters in catalog order.
    pub fn adapters(&self) -> impl Iterator<Item = &ProviderAdapterHandle> {
        self.iter().map(RegisteredProvider::adapter)
    }

    /// Registered provider ids in catalog order.
    pub fn provider_ids(&self) -> Vec<String> {
        self.iter()
            .map(|provider| provider.id().to_string())
            .collect()
    }
}

/// The process-wide registry. Initialized on first use from the built-in
/// factories; installed providers join here in a later increment.
pub fn provider_registry() -> &'static ProviderRegistry {
    static REGISTRY: OnceLock<ProviderRegistry> = OnceLock::new();
    REGISTRY.get_or_init(ProviderRegistry::with_builtins)
}

#[cfg(test)]
mod tests {
    use super::{provider_registry, ProviderAdapterHandle, ProviderRegistry, RegisteredProvider};
    use crate::domain::agents::runtime::DEFAULT_PROVIDER;

    /// Parity freeze: the registry exposes exactly the providers the static
    /// `ADAPTERS` slice used to, in the same order. Ordering is user-visible.
    #[test]
    fn registry_preserves_builtin_provider_order() {
        assert_eq!(
            provider_registry().provider_ids(),
            vec!["claude_code", "codex_cli", "cursor", "opencode"]
        );
    }

    /// Every registered id must be the id its adapter advertises, otherwise
    /// catalog lookups and runtime dispatch would disagree.
    #[test]
    fn registered_ids_match_adapter_catalog_ids() {
        for provider in provider_registry().iter() {
            assert_eq!(
                provider.adapter().catalog_entry().id,
                provider.id(),
                "catalog entry id mismatch for {}",
                provider.id()
            );
        }
    }

    #[test]
    fn registry_resolves_every_registered_id_and_rejects_unknown_ones() {
        for id in provider_registry().provider_ids() {
            let adapter = provider_registry()
                .adapter(&id)
                .unwrap_or_else(|| panic!("adapter for {id}"));
            assert_eq!(adapter.catalog_entry().id, id);
            assert!(provider_registry().contains(&id));
        }
        assert!(provider_registry().adapter("unknown").is_none());
        assert!(!provider_registry().contains("unknown"));
    }

    /// The compiled default provider must exist in the registry — otherwise the
    /// catalog would silently fall back to an arbitrary first entry.
    #[test]
    fn default_provider_is_registered() {
        assert!(provider_registry().contains(DEFAULT_PROVIDER));
    }

    /// The property that matters, independent of which handle variant a
    /// provider uses: repeated lookups resolve to the *same* adapter instance.
    /// Adapters cache probe results, so two instances would silently split the
    /// cache and make the catalog depend on which lookup won.
    ///
    /// The casts drop the vtable half of each fat pointer and compare data
    /// addresses, which is exactly the identity question being asked.
    #[test]
    fn repeated_lookups_resolve_to_one_shared_instance() {
        for id in provider_registry().provider_ids() {
            let first = provider_registry().adapter(&id).expect("adapter");
            let second = provider_registry().adapter(&id).expect("adapter");
            assert_eq!(
                first.as_adapter() as *const _ as *const u8,
                second.as_adapter() as *const _ as *const u8,
                "{id} handed out two adapter instances"
            );
        }
    }

    /// Claude Code's warmup writes the `CLAUDE_CODE_ADAPTER` static directly
    /// (`spawn_startup_warmup(&self)` can't move `self` into a `'static` task),
    /// so the registry must hand out that same static rather than a copy —
    /// otherwise lookups read a cache the warmup never fills. Making Claude
    /// Code registry-owned requires changing warmup in the same edit.
    #[test]
    fn claude_code_resolves_to_the_static_its_warmup_fills() {
        let claude = provider_registry().adapter("claude_code").expect("claude");
        assert_eq!(
            claude.as_adapter() as *const _ as *const u8,
            &crate::domain::agents::claude_code::CLAUDE_CODE_ADAPTER as *const _ as *const u8,
        );
    }

    /// Migration freeze — not a permanent invariant. It pins the provider-owned
    /// defaults across the `&'static str` → `Cow` re-typing, where a silent
    /// regression would surface as a wrong chip, a wrong workspace setting key,
    /// or config files missing from a new worktree. A deliberate change to any
    /// provider's defaults should update this table, not work around it.
    #[test]
    fn builtin_defaults_are_unchanged() {
        let expected: &[(&str, &str, Option<&str>, &[&str])] = &[
            (
                "claude_code",
                "acceptEdits",
                None,
                &[
                    ".claude/settings.local.json",
                    ".claude/settings.json",
                    ".claude/skills",
                    ".claude/commands",
                    ".claude/rules",
                    ".mcp.json",
                ],
            ),
            (
                "codex_cli",
                "default",
                Some("codex_permission_mode"),
                &[
                    ".codex/config.toml",
                    ".codex/hooks.json",
                    ".codex/rules",
                    ".codex/agents",
                    ".codex/skills",
                ],
            ),
            (
                "cursor",
                "default",
                Some("cursor_access_mode"),
                &[
                    ".cursor/rules",
                    ".cursor/commands",
                    ".cursor/skills",
                    ".cursor/mcp.json",
                    ".cursor/cli.json",
                ],
            ),
            (
                "opencode",
                "acceptEdits",
                None,
                &[
                    "opencode.json",
                    ".opencode/agents",
                    ".opencode/commands",
                    ".opencode/skills",
                ],
            ),
        ];

        for (id, mode_wire, access_key, config_paths) in expected {
            let adapter = provider_registry()
                .adapter(id)
                .unwrap_or_else(|| panic!("adapter for {id}"));
            assert_eq!(adapter.default_permission_mode_wire(), *mode_wire, "{id}");
            assert_eq!(
                adapter.access_mode_setting_key().as_deref(),
                *access_key,
                "{id}"
            );
            assert_eq!(
                adapter.worktree_config_paths(),
                config_paths
                    .iter()
                    .map(|path| std::borrow::Cow::Borrowed(*path))
                    .collect::<Vec<_>>(),
                "{id}"
            );
        }
    }

    #[test]
    fn duplicate_registrations_keep_the_first_entry() {
        let cursor = ProviderAdapterHandle::owned(crate::domain::agents::cursor::CursorAdapter);
        let registry = ProviderRegistry::from_providers([
            RegisteredProvider::new("cursor", cursor.clone()),
            RegisteredProvider::new("cursor", cursor),
            RegisteredProvider::new(
                "opencode",
                ProviderAdapterHandle::owned(crate::domain::agents::opencode::OpenCodeAdapter),
            ),
        ]);
        assert_eq!(registry.provider_ids(), vec!["cursor", "opencode"]);
    }

    /// A dynamically owned id resolves and dispatches the same way a borrowed
    /// built-in id does. This is the seam installed providers will use.
    #[test]
    fn runtime_registered_providers_join_the_ordered_registry() {
        let installed = RegisteredProvider::new(
            String::from("cursor"),
            ProviderAdapterHandle::owned(crate::domain::agents::cursor::CursorAdapter),
        );
        let registry = ProviderRegistry::from_providers([installed]);

        assert_eq!(registry.provider_ids(), vec!["cursor"]);
        assert!(registry.contains("cursor"));
        assert_eq!(
            registry
                .adapter("cursor")
                .expect("installed adapter")
                .catalog_entry()
                .id,
            "cursor"
        );
    }

    #[test]
    fn mismatched_registry_and_catalog_ids_are_rejected() {
        let registry = ProviderRegistry::from_providers([RegisteredProvider::new(
            "installed_example",
            ProviderAdapterHandle::owned(crate::domain::agents::cursor::CursorAdapter),
        )]);

        assert!(registry.provider_ids().is_empty());
        assert!(registry.adapter("installed_example").is_none());
    }

    #[test]
    fn empty_registry_resolves_nothing() {
        let registry = ProviderRegistry::default();
        assert!(registry.provider_ids().is_empty());
        assert!(registry.adapter("claude_code").is_none());
    }
}

//! Custom tabs: local web-UI plugins shown as a feature-page tab.
//!
//! The contract is `docs/CUSTOM_TABS.md`. A tab is a folder under
//! `~/.cadencr/plugins/tabs/<id>/` holding `tab.json` and a built `dist/`;
//! validation lives in `cadencr_plugin_core::tab` so the CLI agrees with the
//! service. This module owns the host side: the registry of folders, the
//! enablement/consent/configuration stores, static asset serving with the
//! guest CSP, the watcher that drives live reload, and authoring.
//!
//! Entry points for other modules:
//! - [`registry::get`] / [`registry::list`] → [`registry::LocalTab`] (validated
//!   manifest + permissions hash);
//! - [`enablement::effective`] — may tab X run in project P right now;
//! - [`config::resolved_values`] / [`config::secret_value`] — settings, server-side.

pub mod assets;
pub mod authoring;
pub mod config;
pub mod consent;
pub mod enablement;
pub mod models;
pub mod paths;
pub mod registry;
pub mod routes;
pub mod scaffold;
pub mod summary;
pub mod watcher;
pub mod workspace;

#[cfg(test)]
mod test_support;

pub use routes::plugin_tabs_router;
pub use watcher::PluginTabChangedEvent;

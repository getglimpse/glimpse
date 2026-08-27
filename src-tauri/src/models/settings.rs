//! Application settings models.
//!
//! This module defines the persistent configuration format of Glimpse.
//!
//! The structures in this module are serialized to and from:
//!
//! ```text
//! settings.json
//! ```
//!
//! Configuration hierarchy:
//!
//! ```text
//! AppSettings
//! ├─ theme
//! ├─ target_groups
//! ├─ current_target_group_id
//! ├─ indexing
//! │   └─ IndexingSettings
//! ├─ commands
//! │   └─ CommandSettings
//! ├─ plugins
//! │   └─ PluginSecuritySettings
//! └─ ui
//!     └─ UiSettings
//! ```
//!
//! These models are shared between:
//!
//! - `commands::settings`
//! - `store::settings`
//! - `store::indexer::runtime`
//! - frontend settings pages

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Search target group.
///
/// A target group represents one logical workspace consisting of one or more
/// filesystem paths.
///
/// Examples:
///
/// ```text
/// Work
/// ├─ ~/Documents/Work
/// └─ ~/Projects
///
/// Personal
/// └─ ~/Notes
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGroup {
    /// Stable unique identifier.
    pub id: String,

    /// User-visible name.
    pub name: String,

    /// Indexed filesystem roots.
    pub paths: Vec<String>,

    /// Whether this group participates in the target group switch cycle.
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum KeybindingValue {
    One(String),
    Many(Vec<String>),
}

pub type KeybindingMap = HashMap<String, KeybindingValue>;

fn one(key: &str) -> KeybindingValue {
    KeybindingValue::One(key.to_string())
}

fn many(keys: &[&str]) -> KeybindingValue {
    KeybindingValue::Many(keys.iter().map(|key| key.to_string()).collect())
}

pub fn default_keybindings() -> KeybindingMap {
    HashMap::from([
        ("toggleMainWindow".into(), one("Alt+Space")),
        ("selectNextItem".into(), one("ArrowDown")),
        ("selectPrevItem".into(), one("ArrowUp")),
        ("selectNextPage".into(), one("PageDown")),
        ("selectPrevPage".into(), one("PageUp")),
        ("openActiveItem".into(), one("Enter")),
        ("scrollActivePreviewDown".into(), one("Ctrl+J")),
        ("scrollActivePreviewUp".into(), one("Ctrl+K")),
        ("createFile".into(), one("Ctrl+N")),
        ("openActiveFileEditor".into(), one("Ctrl+O")),
        ("pinActivePreview".into(), one("Ctrl+T")),
        ("switchNextPreviewTab".into(), one("Ctrl+Tab")),
        ("switchPrevPreviewTab".into(), one("Ctrl+Shift+Tab")),
        ("closeActivePreviewTab".into(), one("Ctrl+W")),
        ("focusSearch".into(), many(&["Ctrl+L", "Ctrl+/"])),
        ("openActiveSourceFile".into(), one("Ctrl+E")),
        ("revealActiveSourceFile".into(), one("Ctrl+Shift+E")),
        ("togglePreviewLayout".into(), one("Ctrl+B")),
        ("toggleLauncherLayout".into(), one("Ctrl+Shift+B")),
        ("togglePreviewMode".into(), one("Alt+V")),
        ("switchTargetGroup".into(), one("Ctrl+R")),
        ("toggleHiddenFilter".into(), one("Ctrl+Shift+1")),
        ("toggleInternalFilter".into(), one("Ctrl+:")),
        ("togglePluginPlaygroundFilter".into(), many(&[])),
        ("openQueryInspector".into(), one("Ctrl+Alt+I")),
        ("openItemHelp".into(), one("Ctrl+H")),
        ("openCommandHistory".into(), many(&[])),
        ("openDebugPage".into(), many(&[])),
        ("openTagCloudPage".into(), many(&[])),
        ("inspectActiveItem".into(), many(&[])),
        ("closePreviewWindow".into(), one("Escape")),
        ("copyActivePreviewContent".into(), one("Ctrl+C")),
        ("copyActivePreviewCodeBlock1".into(), one("Ctrl+1")),
        ("copyActivePreviewCodeBlock2".into(), one("Ctrl+2")),
        ("copyActivePreviewCodeBlock3".into(), one("Ctrl+3")),
        ("copyActivePreviewCodeBlock4".into(), one("Ctrl+4")),
        ("openSettingsFile".into(), one("Ctrl+,")),
    ])
}

/// Root application settings.
///
/// This structure mirrors `settings.json`.
///
/// It contains:
///
/// - theme configuration
/// - search target groups
/// - indexing rules
/// - command security policies
/// - UI preferences
/// - experimental feature flags
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Active theme identifier.
    pub theme: String,

    /// Available target groups.
    #[serde(default)]
    pub target_groups: Vec<TargetGroup>,

    /// Currently selected target group.
    #[serde(default)]
    pub current_target_group_id: Option<String>,

    /// Indexing configuration.
    #[serde(default)]
    pub indexing: IndexingSettings,

    /// Command execution settings.
    #[serde(default)]
    pub commands: CommandSettings,

    /// Plugin security and trust settings.
    #[serde(default)]
    pub plugins: PluginSecuritySettings,

    /// User interface settings.
    #[serde(default)]
    pub ui: UiSettings,

    /// Experimental feature flags.
    #[serde(default)]
    pub experimental: ExperimentalSettings,

    /// Keyboard shortcut settings.
    #[serde(default)]
    pub keybindings: KeybindingMap,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "nord".to_string(),
            target_groups: Vec::new(),
            current_target_group_id: None,
            indexing: IndexingSettings::default(),
            commands: CommandSettings::default(),
            plugins: PluginSecuritySettings::default(),
            ui: UiSettings::default(),
            experimental: ExperimentalSettings::default(),
            keybindings: default_keybindings(),
        }
    }
}

/// Partial application settings.
///
/// Used when updating only a subset of settings.
///
/// Fields set to `None` are ignored during merge.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartialAppSettings {
    pub theme: Option<String>,
    pub target_groups: Option<Vec<TargetGroup>>,
    pub current_target_group_id: Option<String>,
    pub indexing: Option<IndexingSettings>,
    pub commands: Option<CommandSettings>,
    pub plugins: Option<PluginSecuritySettings>,
    pub ui: Option<PartialUiSettings>,
    pub experimental: Option<PartialExperimentalSettings>,
    pub keybindings: Option<KeybindingMap>,
}

/// Plugin security settings.
///
/// Plugins are local frontend code. `main.js` is blocked until the user
/// explicitly trusts the current plugin fingerprint.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSecuritySettings {
    #[serde(default)]
    pub trusted_plugins: HashMap<String, PluginTrustRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginTrustRecord {
    #[serde(default)]
    pub trusted: bool,

    #[serde(default)]
    pub trusted_at: Option<String>,

    #[serde(default)]
    pub manifest_fingerprint: Option<String>,

    #[serde(default)]
    pub version: Option<String>,
}

/// User interface preferences.
///
/// Controls frontend appearance and behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    /// Enables compact sidebar list items.
    #[serde(default)]
    pub compact_list_items: bool,

    /// Hides the main window to the system tray when closing it.
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,

    /// UI language code.
    ///
    /// Examples:
    ///
    /// - `en`
    /// - `ja`
    /// - `de`
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "en".to_string()
}

fn default_close_to_tray() -> bool {
    true
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            compact_list_items: false,
            close_to_tray: default_close_to_tray(),
            language: default_language(),
        }
    }
}

/// Experimental feature flags.
///
/// These options may be useful, but can depend on operating-system or
/// application-specific behavior.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentalSettings {
    /// Reads selected text from the foreground app when opening Glimpse and
    /// uses it as the search query.
    #[serde(default)]
    pub capture_selected_text_on_activation: bool,
}

impl AppSettings {
    pub fn current_target_group_name(&self) -> String {
        self.current_target_group_id
            .as_ref()
            .and_then(|current_id| {
                self.target_groups
                    .iter()
                    .find(|group| &group.id == current_id)
            })
            .map(|group| group.name.clone())
            .unwrap_or_else(|| "Default".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartialUiSettings {
    #[serde(default)]
    pub compact_list_items: Option<bool>,

    #[serde(default)]
    pub close_to_tray: Option<bool>,

    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartialExperimentalSettings {
    #[serde(default)]
    pub capture_selected_text_on_activation: Option<bool>,
}

/// Filesystem indexing configuration.
///
/// Controls how Glimpse scans and indexes files.
///
/// Includes:
///
/// - hidden file handling
/// - ignore patterns
/// - file size limits
/// - excluded extensions
///
/// These settings affect:
///
/// - full scans
/// - realtime watch indexing
/// - manual indexing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingSettings {
    #[serde(default = "default_ignore_hidden_files")]
    pub ignore_hidden_files: bool,

    #[serde(default)]
    pub ignore_patterns: Vec<String>,

    #[serde(default = "default_max_file_size_bytes")]
    pub max_file_size_bytes: Option<u64>,

    #[serde(default = "default_excluded_extensions")]
    pub excluded_extensions: Vec<String>,
}

fn default_ignore_hidden_files() -> bool {
    true
}

fn default_max_file_size_bytes() -> Option<u64> {
    Some(1024 * 1024)
}

fn default_excluded_extensions() -> Vec<String> {
    vec![
        "exe".to_string(),
        "dll".to_string(),
        "zip".to_string(),
        "7z".to_string(),
        "db".to_string(),
        "sqlite".to_string(),
        "sqlite3".to_string(),
    ]
}

impl Default for IndexingSettings {
    fn default() -> Self {
        Self {
            ignore_hidden_files: true,
            ignore_patterns: vec![
                ".glimpse/**".to_string(),
                ".git/**".to_string(),
                "node_modules/**".to_string(),
                "target/**".to_string(),
                "dist/**".to_string(),
                "*.log".to_string(),
                ".trash/**".to_string(),
            ],
            max_file_size_bytes: default_max_file_size_bytes(),
            excluded_extensions: default_excluded_extensions(),
        }
    }
}

/// Command execution policy mode.
///
/// Determines how executable commands are filtered.
///
/// Modes:
///
/// - `None`
///   Allow all commands.
///
/// - `Whitelist`
///   Allow only commands listed in `whitelist`.
///
/// - `Blacklist`
///   Block commands listed in `blacklist`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CommandPolicyMode {
    None,
    Whitelist,
    Blacklist,
}

impl Default for CommandPolicyMode {
    fn default() -> Self {
        Self::Blacklist
    }
}

/// Command execution security settings.
///
/// Controls which commands are allowed to run.
///
/// Security layers:
///
/// ```text
/// command
///    ↓
/// trusted_directories
///    ↓
/// whitelist / blacklist
///    ↓
/// execute?
/// ```
///
/// These settings are enforced by:
///
/// - `utils::command_policy`
/// - `utils::trusted_directories`
/// - `commands::action`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSettings {
    #[serde(default)]
    pub policy_mode: CommandPolicyMode,

    #[serde(default)]
    pub whitelist: Vec<String>,

    #[serde(default = "default_command_blacklist")]
    pub blacklist: Vec<String>,

    #[serde(default)]
    pub trusted_directories: Vec<String>,
}

fn default_command_blacklist() -> Vec<String> {
    vec![
        "rm".to_string(),
        "sudo".to_string(),
        "su".to_string(),
        "sh".to_string(),
        "bash".to_string(),
        "zsh".to_string(),
        "fish".to_string(),
        "cmd".to_string(),
        "powershell".to_string(),
        "pwsh".to_string(),
    ]
}

impl Default for CommandSettings {
    fn default() -> Self {
        Self {
            policy_mode: CommandPolicyMode::Blacklist,
            whitelist: Vec::new(),
            blacklist: default_command_blacklist(),
            trusted_directories: Vec::new(),
        }
    }
}

#[test]
fn default_settings_include_indexing_rules() {
    let settings = AppSettings::default();

    assert!(settings.indexing.ignore_hidden_files);
    assert!(settings
        .indexing
        .ignore_patterns
        .contains(&".git/**".to_string()));
    assert!(!settings
        .indexing
        .excluded_extensions
        .contains(&"mp4".to_string()));
    assert!(!settings
        .indexing
        .excluded_extensions
        .contains(&"mov".to_string()));
}

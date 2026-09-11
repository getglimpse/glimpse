//! Plugin manifest models.
//!
//! Plugin manifests are loaded from:
//!
//! ```text
//! <app_data_dir>/plugins/*/manifest.json
//! ```
//!
//! The frontend receives these definitions and decides how to expose supported
//! contributions in the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: Option<String>,
    pub author: Option<String>,
    pub release_date: Option<String>,
    pub repository_url: Option<String>,
    pub homepage_url: Option<String>,
    pub support_url: Option<String>,
    pub description: Option<String>,
    pub default_locale: Option<String>,
    pub i18n: Option<serde_json::Value>,
    pub i18n_path: Option<String>,
    pub page: Option<String>,
    pub page_definition: Option<serde_json::Value>,
    pub enabled_by_default: Option<bool>,
    pub entrypoints: Option<PluginEntrypoints>,
    pub contributes: Option<PluginContributions>,
    pub dependencies: Option<PluginDependencies>,
    pub capabilities: Option<PluginCapabilities>,
    pub settings: Option<serde_json::Value>,
    pub internal_pages: Option<Vec<PluginInternalPageManifest>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiscoveryReport {
    pub manifests: Vec<PluginManifest>,
    pub errors: Vec<PluginDiscoveryError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiscoveryError {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntrypoints {
    pub main: Option<String>,
    pub page: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: Option<String>,
    pub author: Option<String>,
    pub release_date: Option<String>,
    pub repository_url: Option<String>,
    pub homepage_url: Option<String>,
    pub support_url: Option<String>,
    pub description: Option<String>,
    pub default_locale: Option<String>,
    pub i18n: Option<serde_json::Value>,
    pub page: Option<String>,
    pub enabled_by_default: Option<bool>,
    pub entrypoints: Option<PluginEntrypoints>,
    pub backend: Option<serde_json::Value>,
    pub contributes: Option<PluginContributions>,
    pub dependencies: Option<PluginDependencies>,
    pub capabilities: Option<PluginCapabilities>,
    pub settings: Option<serde_json::Value>,
    pub internal_pages: Option<Vec<PluginInternalPageManifest>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginContributions {
    pub internal_page: Option<PluginInternalPageManifest>,
    pub internal_pages: Option<Vec<PluginInternalPageManifest>>,
    pub actions: Option<Vec<PluginActionManifest>>,
    pub viewers: Option<Vec<PluginViewerManifest>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginActionManifest {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub title_key: Option<String>,
    pub title_fallback: Option<String>,
    pub description: Option<String>,
    pub description_key: Option<String>,
    pub description_fallback: Option<String>,
    pub input: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginViewerManifest {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub title_key: Option<String>,
    pub title_fallback: Option<String>,
    pub description: Option<String>,
    pub description_key: Option<String>,
    pub description_fallback: Option<String>,
    pub extensions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDependencies {
    pub plugins: Option<Vec<PluginDependencyManifest>>,
    pub npm: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilities {
    pub files: Option<PluginFileCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileCapabilities {
    pub read: Option<PluginFileReadScope>,
    pub write: Option<PluginFileWriteScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginFileReadScope {
    None,
    ActiveTab,
    TargetGroup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginFileWriteScope {
    None,
    DeclaredOutputDirectory,
    TargetGroup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDependencyManifest {
    pub id: String,
    pub version: Option<String>,
    pub optional: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntrypointSource {
    pub plugin_id: String,
    pub entrypoint: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAssetSource {
    pub plugin_id: String,
    pub asset: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginReadmeSource {
    pub plugin_id: String,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTrustStatus {
    pub plugin_id: String,
    pub trusted: bool,
    pub trust_required: bool,
    pub reason: Option<String>,
    pub trusted_at: Option<String>,
    pub manifest_fingerprint: String,
    pub trusted_fingerprint: Option<String>,
    pub version: String,
    pub trusted_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallResult {
    pub plugin_id: String,
    pub installed_path: String,
    pub replaced: bool,
    pub manifest: PluginManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUninstallResult {
    pub plugin_id: String,
    pub removed_path: String,
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInternalPageManifest {
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub title_key: Option<String>,
    pub title_fallback: Option<String>,
    pub tags: Option<Vec<String>>,
    pub aliases: Option<Vec<String>>,
    pub boost: Option<f64>,
    pub page_action: Option<PluginPageActionManifest>,
    pub help: Option<PluginPageHelpContent>,
    pub static_page: Option<PluginStaticPageContent>,
    pub page_definition: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPageActionManifest {
    pub action_id: String,
    pub input_placeholder: Option<String>,
    pub examples: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPageHelpContent {
    pub description: Option<String>,
    pub examples: Option<Vec<String>>,
    pub commands: Option<Vec<PluginPageHelpCommand>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPageHelpCommand {
    pub command: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStaticPageContent {
    pub subtitle: Option<String>,
    pub sections: Option<Vec<PluginStaticPageSection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStaticPageSection {
    pub title: String,
    pub rows: Option<Vec<PluginStaticPageRow>>,
    pub paragraphs: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStaticPageRow {
    pub label: String,
    pub value: String,
}

# Changelog

This page records the release history of Glimpse.

## v0.2.2

### Added

#### Settings

* Added an Experimental section to the Settings page.
* Added an opt-in setting to use selected text from the foreground app as the search query when opening Glimpse with the global shortcut.

### Changed

#### Shortcuts

* The selected-text query capture behavior is disabled by default and only runs when the experimental setting is enabled.

### Fixed

#### Indexing

* Removed an unused import warning in the indexer scan module.

## v0.2.1

### Changed

#### Documentation

* Expanded the default workspace examples.
* Added more guidance for search usage.

### Fixed

#### Documentation

* Fixed the GitHub Pages documentation workflow by relying on the pnpm version declared in `package.json`.
* Switched the documentation workflow to Corepack so the pnpm setup no longer emits the Node.js 20 deprecation warning.

## v0.2.0

### Added

#### Search

* Added starred item prioritization in search results.
* Added hidden item search with `!` and `*!`.

#### Indexing

* Added metadata-only indexing for large document, audio, video, PDF, and Office files.

#### Preview

* Added plugin viewer support for trusted local plugins.

#### Internal Pages

* Added Command History and Plugin Page.
* Added In-App Help for supported Internal Pages.

#### Plugins

* Added the local frontend-only plugin system with explicit trust checks.
* Added plugin actions, Internal Pages, viewers, styles, i18n, and scoped file read permissions.
* Added sample plugins for calculator, date calculator, unit converter, PDF viewer, CSV viewer, HTML viewer, and Office documents viewer.

#### Documentation

* Updated user documentation in English and Japanese.
* Added and refreshed developer documentation.
* Updated the roadmap to match the current implementation and priorities.

### Changed

#### Search

* Switched index management to stable Source IDs.
* Improved re-indexing after file updates, renames, and deletes.
* Clarified that only `.gjson` files are parsed as Glimpse JSON indexes; ordinary `.json` files are indexed as raw files.
* Renamed the user-facing priority metadata from `pinned` to `star` while keeping legacy `pinned` compatibility.

#### UI

* Reorganized the Settings page.
* Improved the Target Groups UI.
* Improved the Command List UI.
* Improved Preview Tabs behavior and keyboard shortcut coverage.

### Fixed

#### Indexing

* Fixed deleted files remaining in search results.
* Fixed search results not refreshing after Full Scan.
* Fixed cases where file watching failed to re-index updated files.
* Fixed stale source path entries not being removed.
* Fixed duplicate `.gjson` entries after updates.

#### Themes

* Fixed an issue where an invalid CSS theme prevented the theme list from updating.

#### Preview

* Improved Preview update timing.
* Improved synchronization between Live Preview and Preview Tabs.

#### Search

* Fixed FTS query generation issues.
* Fixed tag and hidden search edge cases.

## v0.1.0

Initial beta release.

### Added

* Local search
* Markdown Preview
* Raw Preview
* External Links
* Internal Pages
* Preview Tabs
* Metadata
* Command Launcher
* Keyboard shortcuts
* Theme system
* Glimpse JSON index (`.gjson`) support
* Markdown indexing
* Full Scan
* Real-time file watching
* Multi-language UI

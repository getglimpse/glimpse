# Changelog

This page records the release history of Glimpse.

## v0.2.7

### Fixed

#### Toasts

* Fixed production app toast layout by bundling Sonner's base styles so toasts stay fixed to the bottom-right corner instead of being pushed up from the window bottom.
* Strengthened Glimpse toast theme selectors so custom colors, borders, icons, and action buttons remain stable after production CSS loading.

## v0.2.6

### Added

#### Markdown Preview

* Added support for opening relative Markdown links such as `[Template](./docs/template)` from the current Markdown file.
* Added extensionless Markdown link resolution using exact paths, `.md`, `index.md`, and `README.md` candidates.
* Added a missing-link warning toast with a `Create` action that opens a fixed-path File Editor tab without creating the file automatically.
* Added external `http` and `https` link handling through the operating system's default browser or app.

#### Documentation

* Updated Markdown Preview user documentation in English and Japanese.
* Updated developer documentation for Markdown link navigation and backend path resolution.

### Changed

#### Preview Tabs

* Relative Markdown links now open as pinned Preview Tabs while Live Preview continues to follow the selected search result.
* Clicking an already-open Markdown link activates and refreshes the existing Preview Tab instead of creating a duplicate.
* Clicking links from a Preview Tab keeps the current tab visible and opens the linked document in its own pinned tab.
* Improved Preview Tab layout so pinned pages share one main content area and no longer shrink each other.
* Improved `Ctrl+Tab`, `Ctrl+Shift+Tab`, and `Ctrl+W` behavior across Live Preview and pinned Preview Tabs.

#### Markdown Preview

* Same-document anchors stay inside the current preview.
* Unsupported link schemes, including `file:`, `javascript:`, and `mailto:`, are blocked instead of being opened.

### Fixed

#### Preview Tabs

* Fixed linked Markdown documents opening to an empty main page.

### Tests

* Added frontend tests for Markdown relative links, missing-link creation actions, web links, blocked schemes, anchors, and preview hydration before opening linked tabs.
* Added backend path resolution tests for target group escapes, symlink escapes, and Windows verbatim path normalization.

## v0.2.4

### Added

#### Plugins

* Added per-action plugin settings for copying successful search-run action results to the clipboard.
* Added click-to-copy support for successful plugin ActionPlayground result bubbles.

### Changed

#### Plugins

* Renamed the plugin search result copy setting to better match where the automatic copy behavior is used.

#### Shortcuts

* Removed the default Ctrl+C shortcut for copying the full active preview content so normal text selection copy works as expected.

## v0.2.3

### Added

#### Preview

* Added temporary saved results and source-path lookup support so newly created or edited files can stay connected to their source preview.

### Changed

#### File Editor

* Improved the `.gjson` file creation and editing panel with localized labels and validation messages.
* Replaced the native `defaultAction` selector with the shared UI Select component.
* Adjusted the responsive `.gjson` editor grid so it switches to two columns at a narrower width.

#### Toasts

* Copy actions are now shown only on toasts where copying is useful, with error toasts remaining copyable by default.

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

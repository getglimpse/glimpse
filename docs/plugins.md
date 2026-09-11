# Plugins

Glimpse can be extended with local and remote plugins.

Plugins can add searchable pages, actions, and file viewers. For example, a plugin can provide a calculator page, a converter page, or a previewer for a file type that Glimpse does not handle by default.

## Opening Plugin Page

Open Plugin Page from the search bar:

```text
:plugin
```

Use Plugin Page to install, trust, enable, disable, or remove plugins. If an
installed plugin includes `README.md`, Plugin Page can show it in the installed
plugin detail so you can review the plugin before enabling it.

Remote plugins are listed separately in Plugin Store. Glimpse downloads the `.glimpse-plugin.zip` archive referenced by the official registry and verifies its SHA-256 checksum before installing it.

## Installing Remote Plugins

Remote plugins appear in Plugin Store:

```text
plugin store
```

1. Open Plugin Store from search.
2. Find the plugin you want to install.
3. Open the plugin details and review the repository, description, and README.
4. Click Install, or Update if an installed plugin has a newer registry version.
5. Click Enable only if you understand the plugin and its source.

Plugin Store can also enable, disable, or uninstall an installed remote plugin from the same detail view. Enabling an untrusted remote plugin records trust for the currently installed files and then turns the plugin on.

An installed remote plugin is still treated like any other plugin. Glimpse does not run `main.js` until the plugin is trusted, and installing or updating a plugin clears the previous trust record.

The author shown in Plugin Store is derived from the GitHub repository owner in the plugin's repository URL. Download counts are optional; when Glimpse does not have a count, Plugin Store shows `-` next to the cloud download icon.

## Installing Local Archives

Plugin Page can also install a local `.glimpse-plugin.zip` archive. Open the local install dialog from the page menu, then add or drop the archive path and install it the same way you would install a plugin folder.

Local archives use the same validation rules as remote downloads: checksum verification is only available for registry installs, but archive layout, file allowlists, path traversal checks, executable checks, and archive size limits still apply.

## Trust

Plugins are not loaded automatically. After installing a plugin, Glimpse asks you to trust it before running its code.

Only trust plugins from a source you understand. Replacing a plugin or changing
its files clears the trust record, so you can review it again before Glimpse
loads it. `README.md` is treated as review material and may be shown before the
plugin is trusted; Glimpse still does not run plugin code until you enable it.

The registry tells Glimpse where to download a plugin and which checksum to expect. It does not replace your trust decision. A checksum detects a changed download, but it does not prove that the plugin is safe or that you want to run it.

## Using Plugins

Trusted plugins can appear in search results like built-in Internal Pages.

Some plugin pages can receive arguments with `>`:

```text
numeric calculator > 1 + 2
```

Viewer plugins can also add previews for supported file types. When a trusted viewer matches the selected file, Glimpse can show that file in the Preview panel.

## Plugin Authors

User documentation only explains how plugins appear in Glimpse. Plugin API specifications and author-facing notes live in the `getglimpse/plugin-template` repository. Free public plugins and the official registry live in `getglimpse/plugins`.

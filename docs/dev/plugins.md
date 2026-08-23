# Plugins

Glimpse plugins are local frontend-only bundles installed under:

```text
<app_data_dir>/plugins/<plugin-id>/
```

The backend validates manifests, copies plugin folders, manages trust, and serves trusted source files. The frontend activates plugin JavaScript and renders plugin contributions.

## Folder Layout

```text
plugin-root/
|-- manifest.json
|-- main.js
|-- page.js        optional
`-- styles.css     optional
```

## Manifest

```json
{
  "id": "first-glimpse-plugin",
  "name": "First Glimpse Plugin",
  "version": "0.1.0",
  "apiVersion": "0.1.0",
  "description": "A sample plugin.",
  "enabledByDefault": true,
  "entrypoints": {
    "main": "./main.js",
    "page": "./page.js"
  },
  "capabilities": {
    "files": {
      "read": "none"
    }
  },
  "contributes": {
    "internalPages": [
      {
        "id": "plugin:first-glimpse-plugin",
        "title": "First Glimpse Plugin",
        "tags": ["internal", "plugin"],
        "aliases": ["first"],
        "pageAction": {
          "actionId": "hello",
          "inputPlaceholder": "Name"
        }
      }
    ],
    "actions": [
      {
        "id": "hello",
        "title": "Say hello"
      }
    ],
    "viewers": [
      {
        "id": "csv",
        "title": "CSV Viewer",
        "extensions": ["csv"]
      }
    ]
  }
}
```

## Manifest Rules

- `id`, `name`, and `version` are required.
- `version` must be a semantic version triplet.
- `apiVersion` defaults to `0.1.0`.
- The supported plugin API version is `0.1.0`.
- `id` must match the plugin directory name.
- Entry paths must stay inside the plugin root.
- Backend declarations are rejected.
- Internal page ids must start with `plugin:<plugin-id>`.
- Action ids and viewer ids are plain ids, not paths.

## Trust

Before Glimpse serves `main.js`, `page.js`, or `styles.css` to the frontend, the plugin must be trusted.

Trust is tied to:

- plugin id
- plugin version
- SHA-256 fingerprints of `manifest.json`, `main.js`, optional `page.js`, and optional `styles.css`

Trust is revoked when:

- the plugin is installed
- the plugin is replaced
- the plugin is uninstalled
- plugin files change
- the plugin version changes

<img class="diagram diagram-lg" src="../assets/diagrams/arch_3.svg" alt="Plugin trust flow">

1. Install, replace, uninstall, or file change: invalidates the previous trusted state.
2. Revoke trust: removes trust when plugin files or lifecycle state change.
3. User reviews plugin: asks the user to inspect and approve the plugin.
4. Set trusted fingerprint: stores approved file fingerprints.
5. Serve trusted source: allows trusted source files to be read by the frontend.
6. Frontend activates plugin: loads the plugin runtime code.
7. Pages, actions, and viewers: makes trusted contributions available in the UI.

## IPC Commands

Backend plugin commands include:

- `get_plugin_manifests`
- `get_plugin_discovery_report`
- `install_plugin_from_path`
- `uninstall_plugin`
- `get_plugin_trust_status`
- `set_plugin_trust`
- `get_plugin_entrypoint_source`
- `get_plugin_asset_source`
- `open_plugins_folder`

Frontend code accesses these through `src/api/plugins.ts`.

## Runtime API

`main.js` exports an activation function.

```js
export default function activate(ctx) {
  ctx.registerAction("hello", (input = "Glimpse") => {
    return `Hello, ${String(input).trim() || "Glimpse"}!`;
  });

  ctx.registerPage("plugin:first-glimpse-plugin", ({ h, components }) => {
    const { Stack, Section, Button, Input, Text } = components;

    return h(
      Stack,
      { gap: "md" },
      h(Text, null, "Rendered by a trusted plugin."),
      h(
        Section,
        { title: "Action" },
        h(Button, { action: "hello", input: "Glimpse" }, "Run"),
        h(Input, {
          action: "hello",
          placeholder: "Name",
          submitLabel: "Greet"
        })
      )
    );
  });
}
```

Available context includes:

- `ctx.registerAction(id, handler)`
- `ctx.registerPage(id, render)`
- `ctx.registerViewer(id, render)`
- `ctx.actions.invoke(id, input)`
- `ctx.files.readText(path)`
- `ctx.files.readBinary(path)`
- `ctx.files.getMetadata(path)`
- `ctx.files.toAssetUrl(path)`
- `ctx.log.info/warn/error`
- `ctx.components`
- `ctx.h`
- `ctx.plugin.id`
- `ctx.api.version`
- `ctx.math`

## Components

Plugins render through Glimpse components:

- `Stack`
- `Text`
- `Section`
- `KeyValueList`
- `Button`
- `Input`
- `Table`
- `Tabs`
- `List`
- `Details`
- `Markdown`
- `DeferredFrame`
- `FileOpenButton`
- `ActionPlayground`
- `CalculationPanel`

Plugins should not import React directly.

## File Read Scopes

Plugins have no file read access by default.

Supported scopes:

| Scope | Behavior |
| ----- | -------- |
| `none` | No file read access |
| `active-tab` | Can read only the file that was active when viewer rendering started |
| `target-group` | Can read files under the current Target Group |

Viewer plugins usually use `active-tab`. Broader `target-group` access should be limited to features that genuinely need cross-file reads.

## Contributions

Plugins can contribute:

- searchable internal pages
- actions
- file-extension viewers
- static page content
- page actions
- help content
- localized labels through `i18n`

Plugin actions can appear as searchable items and receive arguments through `>`.

## Samples

Sample plugins live under `plugins/`.

- `first-glimpse-plugin`
- `numeric-calculator-plugin`
- `date-calculator-plugin`
- `unit-converter-plugin`
- `pdf-viewer-plugin`
- `csv-viewer-plugin`
- `office-documents-viewer-plugin`

Install a plugin from the Plugin Page by entering its absolute folder path, then trust and enable it.

# Plugins

Glimpse can be extended with local plugins.

Plugins can add searchable pages, actions, and file viewers. For example, a plugin can provide a calculator page, a converter page, or a previewer for a file type that Glimpse does not handle by default.

## Opening Plugin Page

Open Plugin Page from the search bar:

```text
:plugin
```

Use Plugin Page to install, trust, enable, disable, or remove local plugins.

## Trust

Plugins are not loaded automatically. After installing a plugin, Glimpse asks you to trust it before running its code.

Only trust plugins from a source you understand. Replacing a plugin or changing its files clears the trust record, so you can review it again before Glimpse loads it.

## Using Plugins

Trusted plugins can appear in search results like built-in Internal Pages.

Some plugin pages can receive arguments with `>`:

```text
numeric calculator > 1 + 2
```

Viewer plugins can also add previews for supported file types. When a trusted viewer matches the selected file, Glimpse can show that file in the Preview panel.

## Plugin Authors

User documentation only explains how plugins appear in Glimpse. Plugin API specifications and author-facing notes live in `.plugins/docs/`. Starter templates live in `.plugin-template/templates/`.

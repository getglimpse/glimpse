# Internal Pages

Internal Pages are application pages that appear in Glimpse search results.

Use `:` to search Internal Pages:

```text
:settings
:help
:plugin
```

Like documents and `.gjson` entries, Internal Pages can be viewed in the Preview panel and pinned as Preview Tabs.

## Available Pages

| Page            | Description                                |
| --------------- | ------------------------------------------ |
| Help            | View built-in usage information            |
| Settings        | Manage application settings                |
| Shortcuts       | View keyboard shortcuts                    |
| About           | Display version and license information    |
| Debug           | Inspect indexing and runtime diagnostics   |
| Command History | View recent command and plugin action runs |
| Plugin Page     | Install, trust, and manage local plugins   |

Trusted plugins can also contribute Internal Pages.

## Arguments

Plugin-provided Internal Pages can receive arguments with `>` when they define a page action.

```text
numeric calculator > 1 + 2
```

Press `Enter` on the selected page to run the action.

## In-App Help

Press `Ctrl + H` on a supported Internal Page to view usage instructions without leaving the current workflow.

# Frontend

The frontend is a React app responsible for the search workflow, preview UI, internal pages, settings screens, and trusted plugin rendering.

## Source Layout

```text
src/
|-- api/          Tauri IPC wrappers
|-- components/   Shared UI components
|-- contexts/     React providers
|-- features/     Feature-specific frontend logic
|-- hooks/        Shared hooks
|-- i18n/         Translation utilities and locale data
|-- types/        Frontend domain types
|-- utils/        Frontend helpers
`-- views/        Internal pages and preview views
```

Feature-specific code should stay under `features/` or `views/`. Shared UI primitives belong in `components/`.

## Application Flow

`src/App.tsx` coordinates the launcher.

It wires together:

- settings loading
- search state
- indexing status
- selected result state
- preview tabs
- internal page routing
- global shortcuts

<img class="diagram diagram-md" src="../assets/diagrams/devfrontend_1.svg" alt="Application flow">

- (1) `parseSearchInput`: parses prefixes, tags, command arguments, and routing hints.
- (2) Internal route?: checks whether the query should stay inside frontend Internal Page search.
- (3a) Internal page results: returns built-in or plugin-provided internal page items.
- (3b) `searchApi.getItems`: sends normal search requests to the backend.
- (4) `ItemList`: renders the result list and selected item state.
- (5) `previewApi.getPreview`: loads preview content for the selected item.
- (6) `usePreviewTabs`: manages Live Preview and pinned Preview Tabs.

Global shortcuts are registered through `useShortcuts` and `createAppShortcuts`. Shortcut events are not part of the main flow; they act on the search input and Preview Tabs as supporting actions.

Long-running or backend-owned work should be accessed through API wrappers instead of being implemented directly in React components.

## API Layer

The `src/api/` modules wrap Tauri IPC commands and provide typed frontend functions.

Examples:

- `src/api/search.ts`
- `src/api/indexing.ts`
- `src/api/settings.ts`
- `src/api/plugins.ts`
- `src/api/commandLogs.ts`

React components should call these wrappers rather than invoking Tauri commands inline.

## Search Input Parsing

`src/features/search/parseSearchInput.ts` parses UI input before the request reaches the backend.

The frontend handles UI-oriented prefixes:

- `>` command argument mode
- `!` hidden-item search
- `#tag` tag collection
- `:` and `/` internal page routing

The backend still receives a structured search request and performs backend query parsing for search engines.

## Preview

Preview rendering lives under `src/views/preview/` and shared preview components live under `src/components/preview/`.

Supported preview modes include:

- Markdown
- raw text
- external URL
- internal page
- plugin viewer

Preview tabs are managed by frontend state. The backend provides the preview payload and open actions attached to each indexed item.

## Plugins

Plugin frontend runtime code lives under `src/features/plugins/`.

The frontend:

- checks trust status
- loads trusted plugin source
- activates plugin modules
- registers plugin pages, actions, and viewers
- renders plugin components
- injects trusted plugin styles

<img class="diagram diagram-md" src="../assets/diagrams/frontend_1.svg" alt="Plugin runtime flow">

1. Enabled plugin manifests: provide frontend-visible plugin declarations.
2. Check trust status: confirms the plugin files match approved fingerprints.
3. Load trusted source: fetches trusted plugin entrypoint code.
4. Activate plugin modules: runs plugin activation in the frontend runtime.
5. Inject trusted styles: adds trusted plugin CSS.
6. Register pages, actions, and viewers: stores plugin contributions in the registry.
7. Render plugin components: displays plugin-provided UI through the component API.

Plugins must render through the Glimpse plugin component API rather than importing React directly.

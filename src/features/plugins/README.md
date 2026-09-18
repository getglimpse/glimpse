# Plugin feature structure

- `components/`: host-provided plugin UI, grouped into shared, Tool, Converter, and Viewer components
- `events/`: lightweight UI event channels shared with other features
- `pages/`: internal plugin pages and Viewer preview rendering
- `registry/`: installed-plugin discovery, localization, and contribution registration
- `remote/`: remote registry validation, catalog state, and view models
- `runtime/`: plugin activation, sandbox communication, worker code, and serialized nodes

Tests are colocated with the area they cover. Prefer importing the public `index.ts` of `components`, `registry`, and `runtime` instead of reaching into their implementation files.

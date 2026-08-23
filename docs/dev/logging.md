# Logging

Logs are used for development, diagnostics, and contributor verification.

## Backend Logging

Backend logs should explain operational state without exposing sensitive values.

Useful log areas include:

- app startup
- settings loading
- indexing scans and watcher events
- search backend initialization
- plugin discovery, install, trust, and source loading
- command execution policy decisions

Avoid logging full secrets, tokens, license keys, or unusually large payloads.

## Command Execution Logs

Command execution history is persisted separately as JSON Lines.

It records command execution events so users can inspect what was run and when.

Command logs should be useful for debugging while avoiding unnecessary environment or secret data.

## Frontend Diagnostics

Frontend diagnostics should be surfaced through internal pages such as Debug and Command History when they help users or contributors understand app state.

The Command History page displays recent commands and plugin actions tracked by the frontend. Backend command logs persist command execution records.

## Guidelines

- Prefer structured fields over long free-form strings.
- Include enough context to identify the subsystem.
- Avoid duplicating high-frequency logs during normal typing.
- Do not log private file contents.
- Do not log secret values.

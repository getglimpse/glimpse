# Documents

Glimpse indexes local files and turns them into searchable items.

Supported content includes:

- Markdown documents
- Glimpse JSON index files (`.gjson`)
- images
- metadata-only references for PDF, Office, audio, and video files
- raw file previews for other files

All indexed items appear in the same search workflow.

## Markdown

Use Markdown for notes, project documents, command references, and other content that benefits from rendered preview.

Markdown files can define frontmatter metadata such as `title`, `tags`, `aliases`, `star`, `hidden`, and `open.*`.

## Glimpse JSON

Use `.gjson` files when one file should create multiple searchable items.

Common examples include:

- bookmark collections
- command launcher entries
- documentation links
- project tools

Only `.gjson` files are parsed as Glimpse JSON indexes. Ordinary `.json` files are indexed as raw files.

## Commands

Command launchers use `open` actions. They can be defined in Markdown frontmatter or in `.gjson` items.

See [Running Commands](./command.md) for details.

## Metadata

Metadata affects search, filtering, display, and open behavior.

See [Metadata](./metadata.md) for the supported fields.

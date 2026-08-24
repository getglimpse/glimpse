# Parser

Parser code lives under:

```text
src-tauri/src/store/parser/
```

The indexer uses `parser_dispatch.rs` to choose a parser from the file extension and source metadata.

## Dispatch

![](../assets/diagrams/parser.svg)

1. Provide the file path, extension, and source metadata used for parser selection.
2. Choose the parser based on source file type and indexing rules.
3. Read the source and apply parser-specific metadata, preview, and action rules.
4. Return zero or more searchable items generated from the source file.

Current parser mapping:

| File type | Parser | Result |
| --------- | ------ | ------ |
| `.md` | `markdown.rs` | One Markdown preview item |
| `.gjson` | `json.rs` | Zero or more items |
| image extensions | `image.rs` | One Markdown preview item containing image syntax |
| PDF, Office, audio, video | `file.rs` | One metadata-only item |
| other files | `raw.rs` | One raw preview item when possible |

Only `.gjson` files are parsed as Glimpse JSON indexes. Regular `.json` files are treated as raw files.

## Markdown Parser

`markdown.rs` reads UTF-8 Markdown files and uses `frontmatter.rs` to extract frontmatter.

Supported frontmatter fields:

- `title`
- `tags`
- `aliases`
- `star`
- `hidden`
- `desc` / `description`
- `url`
- `iframe`
- `command`
- `defaultAction`

Rendered previews use the Markdown content after frontmatter has been removed.

## Glimpse JSON Parser

`.gjson` files use this shape:

```json
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust book",
      "iframe": true,
      "tags": ["rust", "docs"],
      "aliases": ["book"],
      "star": true,
      "hidden": false,
      "boost": 1.5
    }
  ]
}
```

When `iframe` is true and `url` exists, the preview is external. Otherwise, the parser generates a local Markdown preview from `desc` and `url`.

Broken `.gjson` files fall back to raw preview during indexing.

## Metadata-Only Parser

`file.rs` indexes metadata without reading file bodies for:

- PDF
- Word, Excel, PowerPoint
- audio
- video

PDF, audio, and video files use Markdown file URL previews. Office files use raw placeholders so viewer plugins can handle them.

## Actions

Parsers keep item URLs, commands, and default actions separate.
Commands pass through sanitization in `utils/command_open.rs`.

Backend-supported item actions:

- `url`
- `command`

Plugin actions are added on the frontend by trusted plugins.

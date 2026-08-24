# パーサー

parser code は次にあります。

```text
src-tauri/src/store/parser/
```

indexer は `parser_dispatch.rs` を使い、file extension から parser を選びます。

## Dispatch

![](../../assets/diagrams/parser.svg)

1. parser selection に使う file path、extension、source metadata を渡します。
2. source file type と indexing rules に基づいて parser を選択
3. source を読込み parser ごとの metadata、preview、item action rules を適用
4. source file から生成された 0 件以上の searchable item を返します。

現在の parser mapping:

| File type | Parser | Result |
| --------- | ------ | ------ |
| `.md` | `markdown.rs` | 1 件の Markdown preview item |
| `.gjson` | `json.rs` | 0 件以上の item |
| image extensions | `image.rs` | image syntax を含む 1 件の Markdown preview item |
| PDF, Office, audio, video | `file.rs` | 1 件の metadata-only item |
| other files | `raw.rs` | 可能な場合は 1 件の raw preview item |

Glimpse JSON index として解析されるのは `.gjson` ファイルだけです。通常の `.json` ファイルは raw file として扱われます。

## Markdown Parser

`markdown.rs` は UTF-8 Markdown file を読み込み、`frontmatter.rs` で frontmatter を抽出します。

対応している frontmatter fields:

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

rendered preview には、frontmatter を取り除いた Markdown content が使われます。

## Glimpse JSON Parser

`.gjson` ファイルは次の形を使います。

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

`iframe` が true で `url` が存在する場合、preview は external になります。それ以外の場合、parser は `desc` と `url` から local Markdown preview を生成します。

壊れた `.gjson` ファイルは、indexing 時に raw preview へ fallback します。

## Metadata-Only Parser

`file.rs` は、次の file body を読まずに metadata だけを index します。

- PDF
- Word, Excel, PowerPoint
- audio
- video

PDF、audio、video file は Markdown file URL preview を使います。Office file は viewer plugin が処理できるよう、raw placeholder を使います。

## Actions

parser は command を `utils/command_open.rs` の sanitization に通します。

backend が対応する item action:

- `url`
- `command`

plugin action は trusted plugin によってフロントエンド側で追加されます。

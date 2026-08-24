# メタデータ

メタデータは、検索、表示、絞り込み、オープン時の動作を制御します。

Markdown では frontmatter、`.gjson` では各 item のプロパティとして定義します。

## Markdown 対応フィールド

| Field       | 説明                                      |
| ----------- | ----------------------------------------- |
| `title`     | 検索結果に表示するタイトル                 |
| `tags`      | 検索や絞り込みに使うタグ。文字列または配列 |
| `aliases`   | 別名や略称。文字列または配列               |
| `star`      | 検索結果で優先する                         |
| `hidden`    | 通常検索から隠す                           |
| `desc` / `description` | 検索可能な説明文                 |
| `url`       | HTTP/HTTPS URL                             |
| `iframe`    | `url` を iframe preview として表示するか   |
| `command`   | 実行コマンド                               |
| `defaultAction` | Enter 時の既定動作: `command` または `url` |

## Markdown の例

```yaml
---
title: Rust Notes
tags: ["rust", "programming"]
aliases: rs
star: true
---

# Rust

Rust is a systems programming language.
```

## `.gjson` 対応フィールド

| Field      | 説明                                      |
| ---------- | ----------------------------------------- |
| `title`    | 検索結果に表示する必須タイトル             |
| `url`      | 任意の外部 URL                             |
| `desc` / `description` | 検索可能な preview text          |
| `iframe`   | `url` を iframe preview として表示するか   |
| `tags`     | 検索や絞り込みに使うタグ。文字列または配列 |
| `aliases`  | 別名や略称。文字列または配列               |
| `star`     | 検索結果で優先する                         |
| `hidden`   | 通常検索から隠す                           |
| `boost`    | 検索 ranking multiplier                    |
| `command`  | 実行コマンド                               |
| `defaultAction` | Enter 時の既定動作: `command` または `url` |

## `.gjson` の例

```json
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust book",
      "iframe": true,
      "tags": ["rust", "docs"],
      "aliases": "rustbook",
      "star": true,
      "hidden": false,
      "boost": 1.5
    }
  ]
}
```

`.gjson` として解析されるのは `.gjson` 拡張子のファイルだけです。通常の `.json` ファイルは Glimpse JSON index としては扱われず、raw file としてインデックスされます。

## hidden item

`hidden: true` のアイテムは通常検索には表示されません。

```yaml
---
title: Private Note
hidden: true
---
```

検索する場合は `!` を付けます。

```text
!private
```

すべての Target Groups から hidden item を検索する場合は `*!private` を使います。

## Actions

Actions を使うと、`Enter` を押したときに URL を開くかコマンドを実行できます。

### 外部 URL

```yaml
---
title: Rust Website
url: https://www.rust-lang.org
---
```

### コマンド

```yaml
---
title: Git
command: git
---
```

コマンド実行は Glimpse のセキュリティ設定に従います。

`url` と `command` の両方がある場合、既定では `Enter` で `command` を実行します。
`defaultAction: url` を設定すると、URL を開く動作を優先できます。

## まとめ

Markdown frontmatter はノート単位のメタデータに向いています。ブックマーク、ツール、リンク、コマンドランチャーのように、1 つのファイルから複数の検索アイテムを作りたい場合は `.gjson` を使います。

# メタデータ

メタデータは、検索、表示、絞り込み、オープン時の動作を制御します。

Markdown では frontmatter、`.gjson` では各 item のプロパティとして定義します。

## 対応フィールド

### Markdown frontmatter

| Field       | 説明                                      |
| ----------- | ----------------------------------------- |
| `title`     | 検索結果に表示するタイトル                 |
| `tags`      | 検索や絞り込みに使うタグ                   |
| `aliases`   | 別名や略称                                 |
| `star`      | 検索結果で優先する                         |
| `hidden`    | 通常検索から隠す                           |
| `open.type` | `external` または `command`                |
| `open.url`  | `external` の URL                          |
| `open.path` | `command` の実行パス                       |

### Glimpse JSON (`.gjson`)

| Field      | 説明                                      |
| ---------- | ----------------------------------------- |
| `title`    | 検索結果に表示する必須タイトル             |
| `url`      | 任意の外部 URL                             |
| `desc`     | 検索可能な preview text                    |
| `iframe`   | `url` を iframe preview として表示するか   |
| `metadata` | tags, aliases, star, hidden, boost         |
| `open`     | 任意の open action override                |

## Markdown の例

```yaml
---
title: Rust Notes
tags:
  - rust
  - programming
aliases:
  - rs
star: true
---

# Rust

Rust is a systems programming language.
```

## `.gjson` の例

```json
{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust book",
      "iframe": true,
      "metadata": {
        "tags": ["rust", "docs"],
        "aliases": ["book"],
        "star": true,
        "hidden": false,
        "boost": 1.5
      }
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

## Open Actions

Open action を使うと、`Enter` を押したときの動作を変更できます。

### 外部 URL

```yaml
---
title: Rust Website
open.type: external
open.url: https://www.rust-lang.org
---
```

### コマンド

```yaml
---
title: Git
open.type: command
open.path: git
---
```

コマンド実行は Glimpse のセキュリティ設定に従います。

## まとめ

Markdown frontmatter はノート単位のメタデータに向いています。ブックマーク、ツール、リンク、コマンドランチャーのように、1 つのファイルから複数の検索アイテムを作りたい場合は `.gjson` を使います。

# コマンド実行

Glimpse では、`open` action を使って検索アイテムをコマンドランチャーにできます。

対象アイテムを選択して `Enter` を押すと、セキュリティ設定で許可されている場合にコマンドが実行されます。

## Markdown の例

```yaml
---
title: Git
tags:
  - command
  - dev
aliases:
  - git cli
open.type: command
open.path: git
---

# Git
```

`Git` を検索して item を選択し、`Enter` を押すと次が実行されます。

```bash
git
```

## `.gjson` の例

```json
{
  "items": [
    {
      "title": "Git",
      "desc": "Run the Git command-line tool",
      "iframe": false,
      "metadata": {
        "tags": ["command", "dev"],
        "aliases": ["git cli"]
      },
      "open": {
        "type": "command",
        "path": "git"
      }
    }
  ]
}
```

この内容を Target Group 内の `.gjson` ファイルとして保存します。

## 引数

`>` を使うと、選択したコマンドへ引数を渡せます。

```text
Git > status
```

実行されるコマンド:

```bash
git status
```

別の例:

```text
Git > log --oneline
```

実行されるコマンド:

```bash
git log --oneline
```

`>` の右側にある文字列全体が引数として渡されます。

## セキュリティ

コマンド実行は、Glimpse のコマンドセキュリティ設定に従います。

- command policy mode
- whitelist
- blacklist
- trusted directories

コマンドがブロックされた場合、Glimpse は実行せずにエラーを表示します。

## よくある用途

- Git command
- project script
- local CLI tool
- documentation generator
- よく使う shell utility

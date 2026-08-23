# 初回起動とワークスペース

Glimpse を初めて起動すると、既定のワークスペースが自動で作成されます。

既定では、Documents フォルダー内に `Glimpse` フォルダーが作成され、検索対象として登録されます。

## 初期ファイル

既定のワークスペースには、最初からいくつかの starter file が含まれています。

```text
Glimpse/
|-- Welcome.md
|-- Getting Started.md
|-- Markdown.md
|-- Metadata.md
|-- Commands.md
`-- Examples/
```

これらのファイルには、Glimpse の基本的な使い方や Markdown の例が含まれています。

## 検索対象

既定のワークスペース以外にも、任意のフォルダーを検索対象として追加できます。

例:

```text
Documents/Notes
Documents/Projects
Obsidian/Vault
```

検索対象は Target Groups で管理します。

## Internal Pages

組み込みのアプリ内ページは Internal Pages として検索できます。

```text
:settings
:about
:plugin
```

## インデックス更新

検索対象フォルダー内の変更は自動で反映されます。

- ファイル作成
- ファイル更新
- ファイル名変更
- ファイル削除

通常は手動でインデックスを再構築する必要はありません。

## Next Steps

ワークスペースの準備ができたら、[Quick Start](./quick-start.md) に進んでください。

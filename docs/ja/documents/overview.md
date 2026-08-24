# ドキュメント

Glimpse はローカルファイルをインデックス化し、検索可能なアイテムとして扱います。

主な検索対象:

- Markdown ドキュメント
- Glimpse JSON index (`.gjson`)
- 画像
- PDF、Office、audio、video などの metadata-only reference
- その他ファイルの Raw preview

インデックスされたアイテムは、すべて同じ検索ワークフローで扱えます。

## Markdown

Markdown は、ノート、プロジェクト資料、コマンドメモなど、本文をプレビューしたい用途に向いています。

frontmatter で `title`、`tags`、`aliases`、`star`、`hidden`、`url`、`command` を設定できます。

## Glimpse JSON

`.gjson` は、1 つのファイルから複数の検索アイテムを作るための形式です。

用途例:

- ブックマーク集
- コマンドランチャー
- ドキュメントリンク
- プロジェクトツール一覧

通常の `.json` は Glimpse JSON index としては扱われず、Raw file としてインデックスされます。

## Commands

コマンドランチャーは `command` を使います。Markdown frontmatter または `.gjson` item で定義できます。

詳しくは [コマンドの実行](./command.md) を参照してください。

## Metadata

Metadata は検索、フィルタリング、表示、開き方に影響します。

対応している項目は [Metadata](./metadata.md) を参照してください。

# プレビュー

Preview パネルでは、Glimpse から離れずに検索結果の内容を確認できます。

検索結果を選択すると Preview が自動で更新されます。内容確認のために `Enter` を押して外部アプリを開く必要はありません。

## Live Preview

```text
Search Results       Live Preview

Rust          ->      Rust.md
Markdown      ->      Markdown.md
Commands      ->      Commands.md
```

Live Preview は現在選択している検索結果に追従します。

## Preview Tabs

`Ctrl + T` を押すと、現在の Preview を Preview Tab として保持できます。

Preview Tabs は検索を続けても閉じられず、必要な資料を開いたままにできます。

## Preview の種類

| Type               | 動作                                                 |
| ------------------ | ---------------------------------------------------- |
| Markdown           | Markdown をレンダリングする                          |
| Raw                | 元のテキストをそのまま表示する                       |
| External           | URL ベースの preview を表示する                      |
| Image              | 対応画像を表示する                                   |
| Metadata-only file | ファイル参照を軽量に表示する                         |
| Plugin viewer      | 信頼済みプラグインで特定形式を表示する               |
| Internal Page      | 組み込みのアプリ内ページやプラグインページを表示する |

## Internal Pages

Settings、Shortcuts、About、Debug、Command History、Plugin Page、信頼済みプラグインページなども Preview パネルに表示されます。

## ショートカット

Preview 関連のショートカットは **Settings -> Shortcuts** で確認・変更できます。

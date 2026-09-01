# Changelog

このページでは、Glimpse のリリース履歴を記録しています。

## v0.2.4

### Added

#### Plugins

- 検索から実行した plugin action の成功結果を clipboard にコピーする per-action plugin setting を追加
- plugin ActionPlayground の成功 result bubble をクリックでコピーできるようにした

### Changed

#### Plugins

- 自動コピーが使われる場所に合わせて、plugin search result copy setting の名前を変更

#### Shortcuts

- 選択テキストの通常コピーを自然に使えるように、active preview content 全体コピーのデフォルト `Ctrl+C` shortcut を削除

## v0.2.3

### Added

#### Preview

- 新規作成・編集したファイルを元の preview とつなげて扱えるように、temporary saved results と source-path lookup support を追加

### Changed

#### File Editor

- `.gjson` ファイルの作成・編集パネルで、表示ラベルと validation message を i18n 化
- `defaultAction` の selector を native select から共通 UI Select component に変更
- `.gjson` editor の responsive grid が、より狭い幅でも2列に切り替わるように調整

#### Toasts

- copy action は必要な toast にだけ表示するように変更し、error toast は引き続きデフォルトで copy 可能にした

## v0.2.2

### Added

#### Settings

- Settings Page に Experimental section を追加
- グローバルショートカットで Glimpse を開くとき、前面アプリの選択テキストを検索 query として使う opt-in 設定を追加

### Changed

#### Shortcuts

- 選択テキストの query 取得はデフォルトで無効化し、実験的設定が有効な場合だけ実行するように変更

### Fixed

#### Indexing

- indexer scan module の unused import warning を解消

## v0.2.1

### Changed

#### Documentation

- default workspace の example を拡充
- search usage のガイドを追加

### Fixed

#### Documentation

- `package.json` で宣言した pnpm version を使うようにし、GitHub Pages documentation workflow を修正
- documentation workflow を Corepack に切り替え、pnpm setup による Node.js 20 deprecation warning が出ないように修正

## v0.2.0

### Added

#### Search

- star item の検索順位優先を追加
- `!` と `*!` による hidden item search を追加

#### Indexing

- 大きい document、audio、video、PDF、Office file 向けの metadata-only indexing を追加

#### Preview

- trusted local plugin 向けの plugin viewer support を追加

#### Internal Pages

- Command History、Plugin Page を追加
- 対応 Internal Page 向けの In-App Help を追加

#### Plugins

- 明示的な trust check を備えた local frontend-only plugin system を追加
- plugin action、Internal Page、viewer、styles、i18n、scoped file read permission を追加
- calculator、date calculator、unit converter、PDF viewer、CSV viewer、HTML viewer、Office documents viewer の sample plugin を追加

#### Documentation

- 英語版・日本語版の user documentation を更新
- developer documentation を追加・更新
- 現在の実装と優先度に合わせて roadmap を更新

### Changed

#### Search

- インデックス管理を安定した Source ID ベースへ変更
- file update、rename、delete 後の再インデックス処理を改善
- Glimpse JSON index として解析する対象を `.gjson` のみに明確化し、通常の `.json` は raw file として扱うよう整理
- user-facing な優先 metadata を `pinned` から `star` へ変更しつつ、legacy `pinned` compatibility を維持

#### UI

- Settings page を整理
- Target Groups UI を改善
- Command List UI を改善
- Preview Tabs behavior と keyboard shortcut coverage を改善

### Fixed

#### Indexing

- 削除済みファイルが検索結果に残る問題を修正
- Full Scan 後に検索結果が更新されない問題を修正
- file watching が更新ファイルの再インデックスに失敗するケースを修正
- stale source path entry が削除されない問題を修正
- `.gjson` 更新後に item が重複登録される問題を修正

#### Themes

- 壊れた CSS theme によって theme list 更新が止まる問題を修正

#### Preview

- Preview update timing を改善
- Live Preview と Preview Tabs の同期を改善

#### Search

- FTS query generation の不具合を修正
- tag search と hidden search の edge case を修正

## v0.1.0

初回ベータリリース。

### Added

- ローカル検索
- Markdown Preview
- Raw Preview
- External Links
- Internal Pages
- Preview Tabs
- Metadata
- Command Launcher
- Keyboard Shortcuts
- Theme System
- Glimpse JSON index (`.gjson`)
- Markdown Index
- Full Scan
- Filesystem Watch
- Multi-language UI

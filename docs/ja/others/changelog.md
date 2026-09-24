# Changelog

このページでは、Glimpse のリリース履歴を記録しています。

## v0.2.8

### Added

#### Plugins

- plugin page に Tool、Converter、Viewer category を追加。`/` で trusted plugin page を検索し、`/#tool`、`/#converter`、`/#viewer` などの tag で絞り込めるようにした
- 選択または drop した file を確認してから変換を実行する、Converter の staged workflow を追加
- Converter に「新規作成」と「上書き」の output mode を追加。「上書き」は file system から drop した file のみに制限
- 新規作成する変換済み file の filename prefix を設定できるようにした
- Form の result history と、copy、最新結果の保存、全結果の保存、reset action を追加
- 検索バーから実行した plugin action を、開いている対応 Playground の history に反映するようにした

#### Settings

- 検証済み settings backup と、読み込みに失敗した `settings.json` を復元する recovery control を追加

### Changed

#### Plugins

- plugin tab を切り替えても Converter の input、result、output mode を保持するようにした
- Converter の output mode label を Glimpse の language setting に連動させ、plugin 側でも customize できるようにした
- plugin registry data を cache して plugin page をより早く検索可能にし、読み込み完了後に現在の検索を更新するようにした

#### Reliability

- File Editor の title change と content update を単一 operation で保存し、atomic file replacement と失敗時の recovery を行うようにした
- settings を atomic write に変更し、更新失敗時は settings、runtime、global shortcut の変更をまとめて rollback するようにした
- file watcher が source ごとの index を transaction で置換し、indexing failure 後も再試行できるようにした

### Fixed

#### Plugins

- Converter の重複実行を防ぎ、変換または output 保存に失敗した場合も staged file を再試行用に保持するようにした
- plugin reload 時に、変更のない runtime を再起動したり、新規 runtime を二重に activate したりしないようにした

#### Search and Preview

- 遅れて完了した古い検索 response が新しい結果や loading state を上書きする問題を修正
- 選択 item の変更後に古い preview response が表示される問題を修正
- Preview Tab の activation を atomic にし、新しい File Editor tab を即座に選択し、同じ file を表す path では既存 tab を再利用するようにした

#### Settings and Shortcuts

- global shortcut の変更を登録前に検証し、登録 error を通知して、失敗時には以前の shortcut を復元するようにした
- 壊れた settings file を暗黙に default で置き換えず、修復または backup recovery 用に保持するようにした
- 設定を連続で切り替えた際の表示遅延や状態の巻き戻りを修正。切り替えを即座に反映し、保存を操作順に処理して、古い応答や file 変更通知が最後の選択を上書きしないようにした

#### Indexing

- file watcher の更新失敗後に index が部分更新状態になり、再試行も抑止される問題を修正

### Security

- plugin の file read、write、overwrite を、file 選択または drag and drop で発行される短時間有効な capability grant に制限
- plugin file operation に directory scope の output grant、有効期限、canonical path check、symlink protection を追加
- RUSTSEC-2026-0285 に対応するため `rustls` を更新

### Tests

- 非同期の search / preview 順序、atomic editor save、settings recovery、shortcut rollback、plugin reload、Converter retry、file grant、atomic indexing の frontend / Rust regression test を追加
- Rust CI workflow を追加し、installer 公開前の release check に frontend test、Rust format、Clippy、Rust test を追加

## v0.2.7

### Fixed

#### Toasts

- production app で Sonner の base style を bundle に含めるようにし、toast が window 下部から押し上がらず右下固定で表示されるように修正
- production CSS 読み込み後も Glimpse の toast theme、border、icon、action button style が安定するように selector を強化

## v0.2.6

### Added

#### Markdown Preview

- `[Template](./docs/template)` のような相対 Markdown link を、現在表示している Markdown file を基準に開けるようにした
- 拡張子なしの Markdown link で、完全一致、`.md`、`index.md`、`README.md` の候補を順に解決するようにした
- リンク先が存在しない場合に warning toast を表示し、`Create` action から固定 path の File Editor tab を開けるようにした。クリックだけでは file を自動作成しない
- `http` / `https` link を OS の既定 browser / app で開けるようにした

#### Documentation

- Markdown Preview の user documentation を英語版・日本語版とも更新
- Markdown link navigation と backend path resolution の developer documentation を更新

### Changed

#### Preview Tabs

- 相対 Markdown link は pinned Preview Tab として開き、Live Preview は選択中の検索結果に追従し続けるようにした
- すでに開いている Markdown link をクリックした場合は、重複 tab を作らず既存の Preview Tab を activate / refresh するようにした
- Preview Tab 内で link をクリックした場合も、現在の tab を表示したままリンク先を別の pinned tab として開くようにした
- pinned page が単一の main content area を共有するように Preview Tab layout を改善し、複数 tab が互いに表示領域を縮めないようにした
- Live Preview と pinned Preview Tabs 間の `Ctrl+Tab`、`Ctrl+Shift+Tab`、`Ctrl+W` の挙動を改善

#### Markdown Preview

- 同一 document 内 anchor は現在の preview 内で処理するようにした
- `file:`、`javascript:`、`mailto:` などの unsupported scheme は開かずに block するようにした

### Fixed

#### Preview Tabs

- link 先の Markdown document を開いたとき、main page が空になる問題を修正

### Tests

- Markdown の相対 link、missing-link creation action、web link、blocked scheme、anchor、linked tab を開く前の preview hydration を frontend test に追加
- target group escape、symlink escape、Windows verbatim path normalization の backend path resolution test を追加

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

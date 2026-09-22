# Glimpse コードレビュー

レビュー日: 2026-09-22

## 総評

全体として、責務の分離、Rust 側のエラー型、パスの canonicalize、プラグイン manifest の検証、検索バックエンドのテストはよく整備されています。特に Rust 側は 440 件、フロントエンド側は 188 件のテストが通過しており、Clippy も警告なしです。

一方で、非同期処理の「最後に開始した処理だけを反映する」保証、renderer から呼べるファイル IPC の権限境界、設定ファイルの耐障害性、watcher の原子的な更新に重要な改善点があります。

重要度別の件数は次のとおりです。

- P0 / Critical: 0 件
- P1 / High: 3 件
- P2 / Medium: 7 件
- P3 / Low: 1 件

## レビュー区分

コード量が約 6.5 万行あるため、次の 6 セクションに分けて確認しました。

1. フロントエンド画面、検索、プレビュー、エディタ
2. プラグイン registry、runtime、converter
3. Tauri IPC、ファイル操作、コマンド実行、安全境界
4. 設定、インデックス、parser、永続化
5. SQLite / Tantivy 検索エンジン
6. テスト、ビルド、リリース基盤

## 1. フロントエンド画面・検索・プレビュー

### [P2] 古い検索リクエストが新しい検索結果を上書きする

対象: `src/features/search/useSearchController.ts:59-129`, `src/features/search/useSearchController.ts:133-135`

`query` が変わるたびに `fetchResults` を開始していますが、request ID、AbortController、または現在の query との照合がありません。たとえば `a` の検索が遅く、後から開始した `ab` が先に完了すると、その後完了した `a` の結果が `setSearchResults` で画面を上書きします。同様に、古いリクエストの `finally` が `isLoading` を `false` にするため、新しい検索が継続中でもローディング表示が終了します。

推奨対応:

- 単調増加する request ID を `useRef` に保持し、最新 ID のレスポンスだけを state に反映する。
- 可能なら IPC 層までキャンセルを伝搬する。
- `isLoading` も最新 request ID に対してだけ解除する。
- 「先に開始した検索が後から完了する」ケースをテストに追加する。

### [P2] 選択変更後に古い preview が表示される

対象: `src/App.tsx:266-290`

effect の cleanup は、まだ開始していない 80ms の timer だけを解除します。`previewApi.getPreview` の呼び出し後に選択 item が変わった場合、古い Promise は有効なままで、完了時に新しい item の `loadedPreview` を上書きします。検索を素早く移動したとき、タイトルと本文が別 item になる可能性があります。

推奨対応:

- effect 内に `cancelled` フラグを設け、cleanup 後の結果を破棄する。
- または取得対象の item ID と現在の item ID を照合してから `setLoadedPreview` する。
- 遅延した preview A の後に preview B が完了する順序と、その逆順をテストする。

### [P2] rename 成功後に本文保存が失敗すると editor が回復不能になり得る

対象: `src/components/preview/FileEditorPanel.tsx:165-170`, `src/components/preview/FileEditorPanel.tsx:206-231`

タイトルと本文を同時に変更した edit では、先にファイルを rename し、その後で本文を書き込みます。rename 成功後に本文更新または再 index が失敗すると、catch へ移動するため editor state は古い `editor.filePath` と `initialTitle` のままです。再試行すると、既に存在しない旧 path を再度 rename しようとして失敗します。ディスク上は「新しい名前・古い本文」という部分成功状態になります。

推奨対応:

- backend に rename、本文更新、index 更新をまとめた 1 コマンドを用意し、失敗時の rollback 方針を持たせる。
- 少なくとも rename 成功直後に editor state を新 path へ更新し、以降の失敗から再試行できるようにする。
- rename 成功・本文更新失敗の fault-injection テストを追加する。

### [P3] state updater 内の代入に tab activation が依存している

対象: `src/hooks/usePreviewTabs.ts:176-220`

`openFileEditorTab` は `setPinnedTabs` の updater 内で外側の `existingId` に代入し、その直後に `if (existingId)` で activation します。React の state updater がいつ実行されるかに副作用の結果を依存させており、Concurrent Rendering では既存 tab が activate されない可能性があります。

推奨対応:

- 現在の tab 一覧から ID を先に導出するか、tab state と active ID を reducer で同時に更新する。
- 同じファイルを 2 回開いたときに既存 tab が選択されるテストを追加する。

## 2. プラグイン registry・runtime・converter

### [P2] plugin reload 時に enabled plugin を二重に activate している

対象: `src/features/plugins/registry/index.ts:261-274`

`reloadPlugins` は、まず `syncPluginRuntimes(getPlugins())` で enabled plugin を activate し、その直後に enabled plugin 全件へ `reloadPluginRuntime` を実行しています。新規 plugin は一度 activate された直後に deactivate / activate され、既存 plugin も不要な activation cycle を通ります。activation に外部状態への登録、重い初期化、ログ出力などがある場合、install、update、uninstall のたびに副作用が二重発生します。

推奨対応:

- runtime 一覧と新 manifest の差分を 1 回だけ計算し、削除分を deactivate、変更分を reload、新規分を activate する。
- 1 回の `reloadPlugins` につき各 plugin の activate が最大 1 回であることをテストする。

## 3. IPC・ファイル操作・安全境界

### [P1] plugin 用ファイル IPC が任意 path を無条件で読み書きできる

Issue: https://github.com/getglimpse/glimpse/issues/8

対象:

- `src-tauri/src/commands/file.rs:74-77`
- `src-tauri/src/commands/file.rs:204-218`
- `src-tauri/src/store/file.rs:77-84`
- `src-tauri/src/store/file.rs:417-455`
- `src-tauri/src/lib.rs:109-122`

通常の `read_text_file` や editor 更新 API は Target Group 内であることを backend で検証しています。一方、`read_plugin_text_input`、`write_plugin_text_output`、`overwrite_plugin_text_input` は renderer から直接 invoke でき、渡された絶対 path に対する backend 側の認可がありません。

現状の converter UI は drag-and-drop や directory picker から path を得ていますが、その由来は frontend の慣習にすぎません。renderer 上の XSS、将来追加される plugin component、または誤った invoke 呼び出しが発生すると、アプリ権限で任意の UTF-8 ファイルを読み、任意の既存ファイルを上書きし、任意の既存 directory にファイルを作成できます。32 MiB 制限と filename sanitize は、path の認可にはなっていません。

推奨対応:

- file/directory picker または drag-drop で得た path に対し、短命で一回限りの capability token を backend が発行する。
- read/overwrite は許可済み file token、create は許可済み directory token を必須にする。
- 最低限、許可 path を backend state に登録して canonical path で照合し、symlink と TOCTOU を考慮する。
- 「picker を経由しない任意 path は拒否される」IPC テストを追加する。

### [P2] global shortcut の再登録失敗が成功として返され、既存 shortcut も失われる

対象: `src-tauri/src/commands/settings.rs:96-115`, `src-tauri/src/shortcuts.rs:34-95`

設定保存後、`register_global_shortcuts` の失敗はログに記録するだけで `set_settings` は成功を返します。さらに再登録処理は最初に `unregister_all` し、その後 1 件ずつ登録するため、競合 shortcut や途中の OS エラーが起きると、以前動いていた shortcut が消えた状態または一部だけ登録された状態になります。UI は返された settings を採用するため、ユーザーには保存成功に見えます。

推奨対応:

- 新 shortcut 群を事前検証し、登録失敗時には以前の shortcut 群を復元する。
- 復元も含めて失敗した場合は IPC error として frontend に返す。
- shortcut 競合時に旧 shortcut が維持される integration test を追加する。

### 補足

コマンド実行については、shell を介さず `Command::new(...).args(...)` を使用し、URL scheme、command path、policy、明示 path の trusted directory を段階的に検証している点は良好です。ただし trusted directory は bare command には適用されないため、設定画面・ドキュメントではその差を明示した方が安全です。

## 4. 設定・インデックス・parser・永続化

### [P1] settings.json が非原子的に上書きされ、破損時は黙って default に戻る

Issue: https://github.com/getglimpse/glimpse/issues/9

対象: `src-tauri/src/store/settings.rs:57-105`, `src-tauri/src/store/settings.rs:163-215`

`save_settings` は `fs::write(path, content)` で本体を直接 truncate / overwrite します。書き込み中のクラッシュ、ディスクフル、セキュリティソフトによる中断などで JSON が途中までになると、次回起動時の `load_settings` は parse error を警告するだけで `AppSettings::default()` を返します。Target Group、command policy、plugin trust、keybinding などの source of truth が一度に失われたように見える動作です。

推奨対応:

- 同一 directory の一時ファイルへ書き込み、`sync_all` 後に atomic rename する。
- 直前の正常版を `.bak` として保持し、parse error 時に復元候補として使う。
- parse error を UI に通知し、default を自動保存して破損ファイルを上書きしない。
- 中断された書き込みと backup recovery のテストを追加する。

### [P2] settings を保存してから runtime 更新するため、エラー時に永続状態と実行状態がずれる

対象: `src-tauri/src/commands/settings.rs:88-118`

`set_settings` は 96 行目で新設定を保存し、112 行目以降で indexer runtime を更新します。runtime rebuild、DB open、watcher 切り替えなどが失敗した場合、IPC は error を返しますが、settings.json は既に新しい値です。frontend は失敗として旧表示を維持する一方、再起動後は新設定が読み込まれるため、ユーザーが認識する状態と永続状態が一致しません。

推奨対応:

- runtime 更新を prepare / commit に分け、新 runtime の準備成功後に settings を atomic 保存して切り替える。
- それが難しい場合は、失敗時に以前の settings を書き戻し、runtime も旧構成へ戻す。
- 「無効な／利用不能な Target Group への変更で runtime 更新が失敗する」ケースをテストする。

### [P1] watcher の更新が非原子的で、失敗後の再試行も抑止される

Issue: https://github.com/getglimpse/glimpse/issues/10

対象: `src-tauri/src/store/indexer/watch.rs:157-196`

watcher は modified time を cache に記録した後、既存 source を削除し、複数 item を 1 件ずつ upsert しています。この順序には次の問題があります。

1. delete 後に一部 upsert が失敗すると、index は部分更新状態になる。
2. fingerprint は全件成功時だけ保存されるものの、in-memory の `modified_cache` は処理前に更新済みである。
3. 同じ modified time の再通知は 157-160 行目で skip され、アプリ再起動、mtime の再変更、または full scan まで修復されない。

full scan では既に `replace_sources` を使用しているため、watcher も同じ原子的な source replacement を利用できます。

推奨対応:

- parse 完了後に `SourceReplacement` を構築し、transactional な `replace_sources` を 1 回呼ぶ。
- cache は commit 成功後にだけ更新する。失敗時は cache entry を削除して再通知を受けられるようにする。
- 2 件目の upsert が失敗する fault-injection テストと、同一 mtime での retry テストを追加する。

## 5. SQLite / Tantivy 検索エンジン

この区分では、今回の静的レビューで独立した P1/P2 finding はありませんでした。

良かった点:

- SQL 値は parameter binding されており、検索 query を SQL 文字列へ直接連結していない。
- source 単位の replace が transaction 境界として用意されている。
- Tantivy の item/chunk 重複排除、snippet、schema version、cache switch に専用テストがある。
- SQLite と Tantivy の双方で hidden、star、reverse、tag、fuzzy の回帰テストがある。

残るリスクは検索エンジンそのものより、前節の watcher から source replacement API を使わず逐次 delete/upsert している呼び出し側にあります。

## 6. テスト・ビルド・リリース基盤

### [P2] release gate がフロントエンドテストを実行していない

対象: `scripts/release-ready.mjs:149-160`, `.github/workflows/release.yml:113-117`

`release:ready` は frontend build と Rust test は実行しますが、`pnpm test` を実行しません。GitHub の release workflow も依存関係を入れた直後に Tauri build/publish へ進みます。このため、TypeScript compile は通るが UI behavior test が失敗する commit でも release draft と installer を生成できます。現在 188 件ある frontend test が release 判定に使われていません。

推奨対応:

- `release-ready.mjs` に `pnpm test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt -- --check` を追加する。
- release workflow では publish job より前に共通 verify job を置き、全 matrix build がそれを `needs` する構成にする。
- 通常の pull request / push 用 CI も追加し、release 時まで失敗を持ち越さない。

## 推奨修正順

1. plugin 用 file IPC を capability ベースに制限する。
2. settings の atomic write / backup recovery を導入する。
3. watcher を source 単位の transactional replace に変更する。
4. 検索と preview に request generation / cancellation を入れる。
5. shortcut 登録と settings/runtime 更新を失敗時に rollback できるようにする。
6. editor の rename + body save を 1 backend operation にまとめる。
7. plugin reload の二重 activation と tab activation の state 更新を整理する。
8. frontend test を CI / release gate に追加する。

## 実行した検証

- `pnpm build`: 成功
- `pnpm test`: 23 files / 188 tests 成功
- `cargo test --manifest-path src-tauri/Cargo.toml`: 440 tests 成功
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: 成功
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: 成功
- `git diff --check`: whitespace error なし

ビルド時には、main chunk 約 1.53 MB（gzip 約 493 KB）と sandbox worker 約 664 KB に対する Vite の chunk size warning が出ています。直ちに correctness issue ではありませんが、起動時間を計測したうえで lazy import / manual chunk の検討余地があります。

## レビュー上の制約

- 実機上での Tauri E2E、OS shortcut 競合、クラッシュ中断、ディスクフル、ファイル watcher の fault injection は未実施です。
- `src/features/plugins/pages/InternalPage.tsx` の未コミット変更はユーザー作業として保持し、変更せずにレビューしました。

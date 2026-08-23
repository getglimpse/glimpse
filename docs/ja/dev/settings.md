# 設定

Glimpse は application data directory に JSON として settings を保存します。

```text
<app_data_dir>/settings.json
```

settings は `src-tauri/src/store/settings.rs` によって読み込み、正規化、保存されます。

## モデル

backend model:

```text
src-tauri/src/models/settings.rs
```

top-level settings:

- `theme`
- `targetGroups`
- `currentTargetGroupId`
- `indexing`
- `commands`
- `plugins`
- `ui`
- `experimental`
- `keybindings`

## デフォルト設定

初回起動時:

<img class="diagram diagram-md" src="../../assets/diagrams/settings_1.svg" alt="Default settings flow">

1. First launch: 保存済み settings がない可能性がある状態で起動します。
2. Create default workspace: 初期 local workspace を準備します。
3. `settings.json` exists?: settings file が存在するか確認します。
4. Create `settings.json`: settings file がなければ作成します。
5. Create: default Target Group と初期値を記録します。
6. Normalize loaded settings: 欠けている field や不正な値を可能な範囲で補正します。
7. Search-ready local setup: local content を検索できる初期状態にします。

## Target Groups

各 Target Group は次を持ちます。

- `id`
- `name`
- `paths`
- `active`

current Target Group は標準検索と current watcher set を制御します。
Active Target Group は `Ctrl + R` の切り替えサイクルに参加します。

## インデックス設定

default:

- hidden file を無視する
- `.glimpse/**` を無視する
- `.git/**` を無視する
- `node_modules/**` を無視する
- `target/**` を無視する
- `dist/**` を無視する
- `*.log` を無視する
- `.trash/**` を無視する
- max file size: 通常 file は 1 MiB
- excluded extensions: executable/archive/database type

metadata-only file type は大きいファイルでも許可されます。

## コマンド設定

command execution は次で制御されます。

- `policyMode`: `none`, `whitelist`, `blacklist`
- `whitelist`
- `blacklist`
- `trustedDirectories`

default policy mode は blacklist です。

## 実験的機能設定

experimental feature flag は次に保存されます。

```text
experimental
```

現在の設定:

- `captureSelectedTextOnActivation`

`captureSelectedTextOnActivation` は、global shortcut でメインウィンドウを開くときに前面アプリの選択テキストを読み取り、検索 query として使う機能です。

default は `false` です。無効な場合、shortcut handler は選択テキスト取得処理を呼びません。

## プラグインの Trust

plugin trust record は次に保存されます。

```text
plugins.trustedPlugins
```

trust は plugin id、version、file fingerprint に紐づきます。plugin の install、replace、uninstall、file change は trust を無効化します。

## Settings Watcher

`settings_watch.rs` は `settings.json` を watch し、次の event を emit します。

```text
settings-changed
```

<img class="diagram diagram-xl" src="../../assets/diagrams/settings_2.svg" alt="Settings watcher flow">

1. `settings.json` change: 保存済み settings の変更を検出します。
2. `settings_watch.rs`: settings file を監視し、backend 側の反応を調整します。
3. `settings-changed` event: settings 変更を frontend に通知します。
4. Target Group switch: current Target Group が変わった場合に active search scope を更新します。
5. Plugin state update: plugin trust、enablement、source availability を更新します。
6. Frontend refresh: settings に依存する UI state を再読み込みします。
7. Indexer and watcher update: 必要に応じて backend indexing work を restart または retarget します。

フロントエンドは `settingsApi.onChanged` で listen します。

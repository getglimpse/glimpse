# プラグイン仕様ドラフト

この文書は Glimpse plugin API の入口です。詳細仕様は用途ごとの文書に分割します。

この仕様は現行実装の説明ではなく、今後の実装をこの形へ寄せるための設計基準として扱います。公開前のため、旧 plugin API との互換性は優先しません。

Custom tab の React 実行、store 表示、安全境界は将来拡張として [plugin-custom.md](./plugin-custom.md) に分けます。

## 仕様の分割

| 文書 | 内容 |
| --- | --- |
| [plugin-manifest.md](./plugin-manifest.md) | `manifest.json`、capabilities、settings、contributions、配布形式。 |
| [plugin-runtime.md](./plugin-runtime.md) | `main.js`、action、file input、file output、viewer、検索バー直接実行、エラー表示。 |
| [plugin-page.md](./plugin-page.md) | `page.json`、1 plugin 1 page、Info page、自動 Settings tab、標準タブ。 |
| [plugin-i18n.md](./plugin-i18n.md) | `i18n.json`、翻訳 key、fallback、validation。 |
| [plugin-security.md](./plugin-security.md) | trust、fingerprint、安全境界、`styles.css` review。 |
| [plugin-custom.md](./plugin-custom.md) | Custom React tab の reserved / future 仕様。 |

## 初期仕様の要点

- plugin API version は `0.2.0` とします。
- 配布形式は folder install を初期仕様とし、`.glimpse-plugin.zip` は future feature とします。
- 1 plugin は 1 plugin page だけを持ちます。
- Info page は `manifest.json` から Glimpse が自動生成します。
- `page.json` は Info 以外の標準タブを静的に宣言します。
- `manifest.json`、`main.js`、`page.json` は必須です。
- `i18n.json` は任意です。`manifest.json` の `i18n` が指定された場合だけ読み込みます。
- `styles.css` は任意です。
- Settings tab は `manifest.settings` がある場合に Glimpse が自動追加します。
- `custom` tab は reserved / future です。初期実装では discovery error にします。
- `dependencies.npm` は reserved / future です。
- file input は path-based file read capability とは別の user gesture input として扱います。
- File output は plugin が直接保存せず、Glimpse が検証して保存します。
- 検索バーの `>` 直接実行は Playground action だけを対象にします。

## 基本構成

```text
plugin-root/
|-- manifest.json  metadata、capabilities、settings、contributions
|-- main.js        action / viewer などのロジック
|-- page.json      Info 以外の plugin page tab 宣言
|-- i18n.json      optional: locale ごとの表示文字列
`-- styles.css     optional: plugin page / viewer の補助スタイル
```

責務は次のように分離します。

- `manifest.json`: プラグインが何であり、何を提供し、何を必要とするかを宣言する。
- `main.js`: action、viewer、converter などのロジックを登録する。
- `page.json`: `playground`、`converter`、`form` など、Info 以外の標準タブを静的に宣言する。
- `i18n.json`: `manifest.i18n` が指定された場合に、locale ごとの表示文字列を定義する。
- `styles.css`: Glimpse が自動 scope した範囲で補助スタイルを定義する。

## 更新ルール

plugin API の仕様を変える場合は、該当する分割先の文書を先に更新します。全体方針、初期仕様の要点、分割構成を変える場合はこの文書も更新します。

Custom tab の React 実行、store 表示、安全境界を変える場合は [plugin-custom.md](./plugin-custom.md) を更新します。

## バージョニング

この仕様の初期対象 API version は `0.2.0` とします。

互換性ルール:

- patch version は後方互換の bug fix。
- minor version は後方互換の component / field 追加。
- major version は破壊的変更。

Glimpse は unsupported `apiVersion` の plugin を discovery error として扱います。

# プラグイン Security 仕様ドラフト

Plugin source は trust 後にだけ読み込まれます。Trust 前に読むのは、静的検査に必要な JSON と metadata に限定します。

この文書は [plugin-spec.md](./plugin-spec.md) の分割先です。Manifest の詳細は [plugin-manifest.md](./plugin-manifest.md)、runtime の詳細は [plugin-runtime.md](./plugin-runtime.md)、page の詳細は [plugin-page.md](./plugin-page.md) を参照してください。

## Trust

Trust は次に紐づきます。

- plugin id
- plugin version
- `manifest.json`
- `main.js`
- `page.json`
- `i18n.json` if `manifest.i18n` is present
- optional `styles.css`

次の場合は trust を取り消します。

- install / replace / uninstall した
- plugin file が変わった
- plugin version が変わった

## Safety boundary

- backend declaration は禁止します。
- entry path は plugin root の内側に限定します。
- file read / write は capability と user gesture によって制限します。
- user gesture file input は path-based file read capability とは別に扱います。
- File output は plugin が直接保存せず、Glimpse が検証して保存します。
- `main.js` は sandbox 内で評価します。
- `page.json` と、`manifest.i18n` が指定する `i18n.json` は trust 前にも読める静的宣言として扱い、plugin JavaScript を実行せずに検査します。
- Custom tab module は初期仕様では読み込みません。
- 初期仕様では `fetch`、storage、`iframe`、外部 script、`eval` / `new Function` / dynamic import を禁止します。
- `dependencies.npm` は reserved / future です。初期仕様では npm package を install / resolve / execute しません。
- `styles.css` は security review で問題がない範囲で許可します。

## styles.css security review

`styles.css` は任意ファイルです。Glimpse は plugin root element に scope attribute を付与し、plugin style はその scope 配下に限定して適用します。Plugin author が selector に手動 prefix を書く必要はありません。

禁止する selector / rule / property:

| 対象 | 理由 |
| --- | --- |
| `@import` | trust 対象外の外部 CSS 読み込みを防ぐ。 |
| `html` / `body` / `:root` selector | app 全体の theme や layout への影響を防ぐ。 |
| `*` selector | app 全体への広範囲な副作用を防ぐ。 |
| plugin scope 外の selector | plugin 外 UI への影響を防ぐ。 |
| 外部 URL を参照する `url()` | trust 対象外の resource 読み込みを防ぐ。 |
| `position: fixed` | app 全体を覆う UI を防ぐ。 |
| 過大な `z-index` | app shell や dialog への干渉を防ぐ。 |
| 広範囲の `pointer-events: none` | 操作不能な UI を防ぐ。 |
| `cursor: none` | 意図しない操作妨害を防ぐ。 |

許可するもの:

- plugin scope 配下の class selector
- layout、spacing、color、typography
- animation、transition
- plugin bundle 内 asset への相対 `url()`

Security review に失敗した場合は plugin discovery error とします。外部影響のない軽微な selector 表現の揺れは discovery warning にできます。

## Fingerprint

初期仕様の fingerprint 対象:

```text
manifest.json
main.js
page.json
i18n.json if manifest.i18n is present
styles.css if present
```

`.glimpse-plugin.zip` を将来追加する場合も、zip 自体ではなく展開後の正規化済み file set を fingerprint 対象にします。

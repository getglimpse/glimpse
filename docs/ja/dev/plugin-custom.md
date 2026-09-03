# プラグイン Custom UI 予約仕様ドラフト

この文書は、将来拡張として予約している plugin page の `custom` tab 仕様ドラフトです。初期実装の対象ではありません。plugin 全体の基本仕様は [plugin-spec.md](./plugin-spec.md) を参照してください。

## 初期仕様での扱い

Custom React tab は初期仕様では実装しません。

- `page.json` に `type: "custom"` を書いた plugin は discovery error にします。
- Plugin store の `custom` badge は将来拡張として予約します。
- Custom tab module の読み込み、React runtime 提供、Browser API 制限は初期実装に含めません。
- 標準タブで表現できない UI が必要になった場合は、まず新しい標準タブテンプレートとして仕様化できるか検討します。

## 位置づけ

Custom tab は、React を使って自由に UI を作るための将来の escape hatch です。

標準的な用途は次のとおりです。

- 自動生成 Info page、自動 Settings tab、標準 `playground` / `converter` / `form` tab では表現できない UI を作る。
- plugin 固有の interactive UI、preview、summary、validation result を表示する。
- 複数 action を plugin 固有の workflow としてまとめる。

一方で、標準タブで表現できる UI は標準タブを優先します。File conversion のように file input / output creation が主役の plugin は `custom` tab ではなく `converter` tab を使います。Password generator のように checkbox、slider、select で parameter を調整する plugin は `form` tab を使います。

## 標準タブテンプレート優先

UI の統一感は、標準タブテンプレートを増やして保ちます。Custom tab は自由度を確保するために残しますが、標準テンプレートで表現できる plugin では使いません。

Custom tab を追加する前に、次のどれかで表現できないか確認します。

| Template | 用途 |
| --- | --- |
| `playground` | 単一 text input の action 実行。 |
| `converter` | file drop / picker / output file 作成。 |
| `form` | checkbox、slider、enum などの typed parameter から action を実行。 |
| 自動 Settings tab | plugin 設定の管理。 |

同じ形の Custom tab が複数 plugin で必要になった場合、その UI は Custom tab に残さず、標準タブテンプレートへ昇格させます。

## page.json での定義

将来 Custom tab を有効化する場合、`page.json` の `tabs` 配列に `type: "custom"` として定義し、React component を含む module と export 名を指定します。

`page.json` は純粋な JSON です。Glimpse は plugin store、install、trust 前確認、search indexing のために `page.json` を読みますが、この段階では plugin JavaScript を実行しません。

Custom tab の React component は、trust 後に tab が表示されるタイミングで lazy load します。配布される Custom tab module は bundle 済み JavaScript のみ許可します。JSX を直接含む module は許可しません。Plugin author は開発時に JSX を使ってもかまいませんが、install される plugin には build 後の JavaScript を含めます。

`page.json`:

```json
{
  "id": "plugin:custom-ui-plugin",
  "tabs": [
    {
      "id": "custom",
      "type": "custom",
      "titleKey": "tabs.custom.title",
      "titleFallback": "Custom",
      "module": "./custom/custom-panel.js",
      "export": "CustomPanel"
    }
  ]
}
```

`custom/custom-panel.js`:

```js
import React, { useState } from "react";

export function CustomPanel({ ctx }) {
  const [value, setValue] = useState("");

  return React.createElement(
    "section",
    null,
    React.createElement("input", {
      value,
      onChange: (event) => setValue(event.target.value)
    }),
    React.createElement(
      "button",
      { onClick: () => ctx.actions.invoke("preview", { value }) },
      ctx.i18n.t("custom.custom.preview", "Preview")
    )
  );
}
```

Custom tab の規則:

- 初期仕様では `type: "custom"` は許可しません。
- `tabs[].id` は page 内で一意にします。
- `module` は plugin root からの相対パスにします。
- `export` は module が export する React component 名にします。省略時は default export を使います。
- React の state、effect、event handler は使用できます。
- 配布される Custom tab module は bundle 済み JavaScript にします。
- React runtime は Glimpse が提供します。
- action ロジックは `main.js` に置き、Custom tab からは `ctx.actions.invoke` で呼び出します。
- `page.json` 内の表示文字列は `titleKey` / `titleFallback` のように宣言します。
- Custom tab module 内の表示文字列は `ctx.i18n.t(key, fallback)` を使います。

## 自由度と境界

将来有効化する場合、Custom tab の UI 実装は React として自由に書けます。

許可するもの:

- React component
- React hooks
- 通常の DOM element
- DOM event handler
- plugin に同梱した CSS

CSS は Custom tab 内では自由に書けます。Glimpse は plugin ごとに CSS scope を分離し、security review で問題がない範囲で `styles.css` を読み込みます。禁止 selector / property は [plugin-security.md](./plugin-security.md) に従います。

Glimpse 側で制御するもの:

- file read / write
- 外部アプリで開く操作
- shell / backend 相当の処理
- plugin action の実行
- capability に依存する操作

つまり、Custom tab は UI を自由に作れますが、Glimpse の外側に影響する操作は `manifest.json` の capability と `main.js` の action を通します。

Custom tab が使える Glimpse API の範囲は、Info page、自動 Settings tab、`playground`、`converter`、`form` などの標準 UI と同じです。Custom tab だけが追加の file / network / shell capability を得ることはありません。

### Browser API

Custom tab は React と DOM event handler を使えますが、外部影響や永続化につながるブラウザ API は初期仕様では禁止します。

| API | 初期仕様 | 理由 |
| --- | --- | --- |
| `fetch` | 未許可 | network access capability が未定義のため。 |
| `localStorage` / `sessionStorage` / IndexedDB / cookie | 未許可 | plugin settings と永続化の責務が重複するため。 |
| `window.open` | 未許可 | 外部起動は Glimpse の確認 UI と action を通すため。 |
| 外部 script 読み込み | 未許可 | trust 対象外の code 実行を防ぐため。 |
| `iframe` | 未許可 | sandbox policy と navigation policy が未定義のため。 |
| `eval` / `new Function` / dynamic import | 未許可 | 静的検査と trust fingerprint の意味が弱くなるため。 |

これらを将来許可する場合は、テンプレートタブと Custom tab の両方で使える capability として `manifest.json` に追加し、plugin store / trust 画面の表示項目も追加します。

## Plugin Store での表示

Custom tab を含む plugin は、将来の plugin store で `custom` badge を表示します。

表示する情報:

- 一覧 card で `custom` badge を表示すること。
- 詳細ページで Custom tab の数と tab title。
- Trust / install 前の確認画面で Custom UI が含まれること。
- Custom tab がテンプレートタブと同じ API 範囲で動くこと。

Glimpse は `page.json` の `tabs` に `type: "custom"` が 1 つ以上含まれる場合、その plugin に `custom` badge を付与します。Plugin author が手動でこの情報を隠すことはできません。

Store indexing と trust 前確認でこの情報を確実に表示するため、tab 構成は `page.json` にだけ置きます。Custom tab module を実行しないと tab 構成がわからない形式は、初期仕様では許可しません。

## Action 連携

Custom tab から plugin logic を実行する場合、`main.js` で登録した action を呼び出します。

```js
function CustomPanel({ ctx }) {
  return React.createElement(
    "button",
    { onClick: () => ctx.actions.invoke("convertFile", { mode: "preview" }) },
    "Preview"
  );
}
```

Action ID は `manifest.json` の `contributes.actions[].id` と一致させます。Custom tab は UI と workflow を担当し、ファイル変換、解析、保存などのロジックは `main.js` に置きます。

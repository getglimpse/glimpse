# プラグイン Page 仕様ドラフト

`page.json` は plugin page の追加タブを表す静的 layout 宣言です。Info page と Settings tab は Glimpse が自動生成するため、plugin author は `page.json` に書きません。

この文書は [plugin-spec.md](./plugin-spec.md) の分割先です。Manifest の詳細は [plugin-manifest.md](./plugin-manifest.md)、runtime の詳細は [plugin-runtime.md](./plugin-runtime.md) を参照してください。

## 基本方針

- 1 plugin は 1 plugin page だけを持ちます。
- `page.json` は必須です。
- Info page は `manifest.json`、capabilities、settings、contributions から Glimpse が自動生成します。
- Settings tab は `manifest.settings` が 1 つ以上ある場合に Glimpse が自動追加します。
- Plugin author は `page.json` に Info tab と Settings tab を書きません。
- `page.json` は純粋な JSON とし、JavaScript、関数、式、`ctx` 参照を含めません。
- Plugin store と install / trust 前の確認画面は、`manifest.json` と `page.json` だけを読んで tab 数、tab title、必要な action / setting 参照を判定します。この段階では plugin JavaScript を実行しません。

Info-only plugin でも `page.json` を置き、`tabs` を空配列にします。

```json
{
  "id": "plugin:html-preview-plugin",
  "tabs": []
}
```

## 基本形

```json
{
  "id": "plugin:file-converter-plugin",
  "tabs": [
    {
      "id": "converter",
      "type": "converter",
      "titleKey": "tabs.converter.title",
      "titleFallback": "Converter",
      "action": "convertFile",
      "accept": ["*/*"],
      "multiple": true,
      "maxBytes": 52428800,
      "maxFiles": 20,
      "outputDirectorySetting": "outputDirectory"
    }
  ]
}
```

## Layout ルール

- 最上位は `id` と `tabs` です。
- `id` は `manifest.contributes.internalPage.id` と一致させます。
- `tabs[].id` は page 内で一意にします。
- Info page は manifest から自動生成されるため、`page.json` の `tabs` には含めません。
- Settings tab は `manifest.settings` から自動生成されるため、`page.json` の `tabs` には含めません。
- 標準タブは `type` によって Glimpse が UI を生成します。
- 初期仕様の `type` は `playground`、`converter`、`form` のみです。
- `custom` は reserved / future です。初期実装では discovery error にします。
- `page.json` は action ロジックを実装しません。action は `main.js` に置きます。
- `page.json` は manifest の setting schema と action declaration を参照します。
- 表示テキストは `titleKey` / `labelKey` などの i18n key と `titleFallback` / `labelFallback` などの literal fallback で宣言します。

## Tab Definition

```ts
type PluginPage = {
  id: `plugin:${string}`;
  tabs: PluginTab[];
};

type PluginTab =
  | PlaygroundTab
  | ConverterTab
  | FormTab;
```

標準タブテンプレートは、UI の統一感と plugin API の安定性を保つための基本単位です。Plugin author はテンプレートの `type` と props を宣言し、Glimpse が実際の UI と interaction を生成します。

初期仕様で扱う標準タブテンプレート:

| Template | 用途 |
| --- | --- |
| `playground` | 単一 text input の action 実行。 |
| `converter` | file drop / picker / output file 作成。text、画像、音声などの file payload を action に渡す。 |
| `form` | checkbox、slider、enum などの typed parameter から action を実行。 |

## Info page

Plugin の基本情報を表示する自動生成ページです。Plugin author は `page.json` に Info tab を定義しません。設定 UI も置きません。

Section:

| Section | 内容 |
| --- | --- |
| `overview` | `manifest.name`、`manifest.description`、主要 contribution の概要。 |
| `metadata` | plugin id、version、author、releaseDate、apiVersion。 |
| `capabilities` | plugin が要求する capability の一覧。 |
| `contributions` | Internal Page、action、viewer などの提供物。 |

HTML preview plugin のように、Target Group 内の `.html` などの非対応ファイルを viewer contribution で表示するだけの plugin は、Playground / Converter / Form を持ちません。その場合の plugin page は自動生成された Info page のみになります。設定項目があれば、Info page と自動 Settings tab の 2 tab になります。

## Settings tab

Settings tab は `manifest.settings` が 1 つ以上ある plugin に Glimpse が自動追加します。

Plugin author は次のような tab を `page.json` に書きません。

```json
{
  "id": "settings",
  "type": "settings"
}
```

Settings の schema と validation は [plugin-manifest.md](./plugin-manifest.md#settings) を参照してください。

## Playground tab

単一の text input を action に渡して結果を見る標準タブです。

```json
{
  "id": "playground",
  "type": "playground",
  "titleKey": "tabs.playground.title",
  "titleFallback": "Playground",
  "action": "calculate",
  "inputPlaceholderKey": "tabs.playground.placeholder",
  "inputPlaceholderFallback": "Expression",
  "examples": ["1 + 1", "sqrt(9)"]
}
```

用途:

- text input の action を手動実行する。
- サンプル入力を並べる。
- 結果を表示する。
- 検索バーの `>` 直接実行対象にする。

Playground は text input のみに対応します。複数 parameter を checkbox、slider、select などで調整する plugin では `Form` を使います。File conversion のように file input が主役の plugin では `Converter` を使います。

## Converter tab

File input / drop / output creation を扱う標準タブです。

```json
{
  "id": "converter",
  "type": "converter",
  "titleKey": "tabs.converter.title",
  "titleFallback": "Converter",
  "action": "convertFile",
  "accept": ["*/*"],
  "multiple": true,
  "maxBytes": 52428800,
  "maxFiles": 20,
  "outputDirectorySetting": "outputDirectory"
}
```

役割:

- ファイルドロップ領域を表示する。
- ファイル picker を表示する。
- `accept`、`multiple`、`maxBytes`、`maxFiles` に合わないファイルを拒否する。
- `main.js` の action に file payload と settings を渡す。
- action output を `outputDirectorySetting` の directory に保存する。
- 作成後に作成先 path と reveal action を表示する。

Converter tab は text 専用ではありません。画像、音声、PDF、archive、複数ファイルなども扱えるように、action input には file payload を渡します。Plugin logic は `input.file` / `input.files`、`type`、`extension`、`text()`、`binary()`、`dataUrl()` を使って必要な形式で読み取ります。

Converter tab は設定 UI を持ちません。Output directory などの設定は Settings tab に置きます。

## Form tab

checkbox、slider、select などの UI control で複数 parameter を調整し、action を実行する標準タブです。

Form tab の定義は、初期仕様では action と fields の対応に絞ります。追加の専用 props は増やさず、`fields[].id` を action input object の key に対応させます。

```json
{
  "id": "generator",
  "type": "form",
  "titleKey": "tabs.generator.title",
  "titleFallback": "Generator",
  "action": "generatePassword",
  "submitLabelKey": "tabs.generator.submit",
  "submitLabelFallback": "Generate",
  "fields": [
    {
      "id": "length",
      "type": "number",
      "labelKey": "tabs.generator.fields.length.label",
      "labelFallback": "Length",
      "default": 16,
      "min": 8,
      "max": 64,
      "control": "slider"
    },
    {
      "id": "symbols",
      "type": "boolean",
      "labelKey": "tabs.generator.fields.symbols.label",
      "labelFallback": "Use symbols",
      "default": true,
      "control": "checkbox"
    },
    {
      "id": "case",
      "type": "enum",
      "labelKey": "tabs.generator.fields.case.label",
      "labelFallback": "Case",
      "default": "mixed",
      "options": [
        { "value": "lower", "labelFallback": "Lower" },
        { "value": "upper", "labelFallback": "Upper" },
        { "value": "mixed", "labelFallback": "Mixed" }
      ],
      "control": "segmented"
    }
  ],
  "result": {
    "type": "text",
    "copy": true
  }
}
```

用途:

- 複数の文字列、数値、boolean、enum input をまとめる。
- password generator のように parameter を調整しながら結果を作る。
- `fields[].id` と action input object の key を対応させる。
- validation error を標準 UI で表示する。

表形式の結果表示が必要な場合は、初期仕様では `Playground` または `Form` の `result.type` として扱います。独立した `table` tab は初期仕様に含めません。

実行履歴は内部ページの Command History に集約します。独立した `history` tab は初期仕様に含めません。

## Custom tab

Custom tab は reserved / future です。初期仕様では実装しません。

```json
{
  "id": "editor",
  "type": "custom",
  "titleKey": "tabs.editor.title",
  "titleFallback": "Editor",
  "module": "./custom/editor.js",
  "export": "EditorTab"
}
```

将来 Custom tab を追加する場合は、`page.json` では component 本体を直接持たず、trust 後に読み込む module と export 名だけを宣言します。標準タブで表現できる UI には Custom tab を使わず、複数 plugin で繰り返し必要になる UI は新しい標準タブテンプレートとして仕様化します。詳細は [plugin-custom.md](./plugin-custom.md) に分けます。

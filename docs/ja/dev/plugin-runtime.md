# プラグイン Runtime 仕様ドラフト

`main.js` は plugin のロジック entrypoint です。UI layout は書かず、action / viewer / lifecycle に集中します。

この文書は [plugin-spec.md](./plugin-spec.md) の分割先です。Manifest の詳細は [plugin-manifest.md](./plugin-manifest.md)、page の詳細は [plugin-page.md](./plugin-page.md) を参照してください。

## 基本形

```js
export default function activate(ctx) {
  ctx.registerAction("convertFile", async (input) => {
    return Promise.all(
      input.files.map(async (file) => {
        const source = await file.text();

        return {
          type: "file",
          fileName: file.name.replace(/\.[^.]+$/i, ".converted.txt"),
          body: `Success Converted!\n${source}`,
          contentType: "text/plain"
        };
      })
    );
  });
}

export function deactivate(ctx) {
  ctx.log.info("file-converter-plugin deactivated");
}
```

## action

Action は `ctx.registerAction(id, handler)` で登録します。

```js
ctx.registerAction("hello", (input) => {
  return `Hello, ${String(input.name ?? "Glimpse")}!`;
});
```

Action handler の規則:

- 同じ plugin 内で `manifest.json` の `contributes.actions[].id` と一致する必要があります。
- sync / async のどちらも可。
- 失敗は `throw new Error(message)` で返します。
- 戻り値は plugin 側が自由に定義できます。
- 標準タブが action を呼ぶ場合は、そのタブが必要とする output shape を plugin 側で返します。
- DOM、window、localStorage などに直接依存しない純粋なロジックを推奨します。

Action input の代表型:

| Type | 例 |
| --- | --- |
| `string` | Playground から渡された文字列 |
| `object` | Form tab から渡された structured input |
| `file` | Converter tab で選択された file payload |

## User gesture file input

ユーザーが plugin page へドロップ、または picker で選択したファイルは、`capabilities.files.read` とは別の action input として扱います。

File input の規則:

- `contributes.actions[].input.type = "file"` を宣言した action だけが file payload を受け取れます。
- file input は任意 MIME / extension、複数ファイル、text / binary の両方を扱えるようにします。
- `accept`、`multiple`、`maxBytes`、`maxFiles` は action declaration 側で指定し、Glimpse が action 実行前に検証します。
- file payload はユーザー操作で選ばれたファイルだけを表し、任意 path の読み取り権限ではありません。
- action handler は file object の `text()`、`binary()`、`dataUrl()` を通じて、その payload の内容だけを読めます。
- `multiple: true` の action には `input.files` を渡します。`multiple: false` または省略時は `input.file` と `input.files[0]` の両方を渡します。
- `ctx.files.readText(path)`、`ctx.files.readBinary(path)`、`ctx.files.getMetadata(path)` のような path-based read には、引き続き `capabilities.files.read` が必要です。
- `converter` tab は file payload を action に渡しますが、それだけでは `active-tab` や `target-group` の read scope を付与しません。

```ts
type PluginFilePayload = {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
  extension?: string;
  text: () => Promise<string>;
  binary: () => Promise<ArrayBuffer>;
  dataUrl: () => Promise<string>;
};

type FileActionInput = {
  file?: PluginFilePayload;
  files: PluginFilePayload[];
  settings: Record<string, unknown>;
};
```

File action input は広く扱います。画像、音声、PDF、archive、複数ファイルなど、Glimpse が action declaration の `accept` / `multiple` / `maxBytes` / `maxFiles` を満たすと判断した payload は action に渡せます。

## Action output

Action output は、標準 tab が扱える型を中心に受け付けます。File output は plugin が直接保存せず、file-like output を返し、Glimpse が capability、settings、user gesture、上書き policy を検証したうえで保存します。

標準タブで使う代表型:

```ts
type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

type PluginActionOutput =
  | string
  | number
  | boolean
  | JsonValue
  | PluginFileOutput
  | PluginFileOutput[];

type PluginFileOutput = {
  type: "file";
  fileName: string;
  contentType?: string;
  body?: string;
  bytes?: ArrayBuffer;
};
```

File output の保存規則:

- `capabilities.files.write = "declared-output-directory"` が必要です。
- action declaration の `output.type = "file"` が必要です。
- `output.directorySetting` は `manifest.settings` に存在する `directory` setting を参照します。
- `fileName` はファイル名だけを受け付けます。絶対パス、path separator、`..` は拒否します。
- `body` と `bytes` のどちらか一方だけを指定します。
- Glimpse は保存先 directory、ファイル名、上書き可否、最終 path が output directory 配下に収まることを検証してから書き込みます。
- 保存後は作成先 path、reveal action、失敗時 error を Glimpse の UI と Command History に記録します。

## viewer

Viewer は特定拡張子の preview を提供します。

```js
ctx.registerViewer("csv", async ({ h, components, sourcePath }) => {
  const text = await ctx.files.readText(sourcePath);

  return h(components.Table, {
    columns: ["Raw"],
    rows: [{ Raw: text }]
  });
});
```

Viewer は通常 `capabilities.files.read = "active-tab"` を使います。

Viewer contribution は Target Group 内の非対応ファイルを preview できるようにする機能です。Plugin page のタブとしては扱わず、Info page の contribution 情報として表示します。

## ctx

`main.js` で利用できる API:

| API | 説明 |
| --- | --- |
| `ctx.registerAction(id, handler)` | action を登録する。 |
| `ctx.registerViewer(id, renderer)` | viewer を登録する。 |
| `ctx.actions.invoke(id, input)` | 同一 plugin の action を呼び出す。 |
| `ctx.files.readText(path)` | capability に基づいて text file を読む。 |
| `ctx.files.readBinary(path)` | capability に基づいて binary file を読む。 |
| `ctx.files.getMetadata(path)` | capability に基づいて metadata を読む。 |
| `ctx.files.toAssetUrl(path)` | viewer 用 asset URL に変換する。 |
| `ctx.log.info/warn/error` | plugin log を記録する。 |
| `ctx.plugin.id` | plugin ID。 |
| `ctx.plugin.version` | plugin version。 |
| `ctx.api.version` | plugin API version。 |
| `ctx.i18n.t(key, fallback)` | localized text を取得する。 |

## 検索バーからの直接実行

検索バーの `>` 直接実行は、初期仕様では Playground action だけを対象にします。

```text
numeric calculator > 1 + 2
```

対象外:

- Converter action
- Form action
- Viewer
- File input action

Playground 以外の action は plugin page から実行します。これは file input、form validation、output 保存、error 表示の責務を標準 UI に集約するためです。

## エラー表示

Runtime error は呼び出し元の UI に合わせて表示します。

| 呼び出し元 | 表示 |
| --- | --- |
| Playground | toast と Command History |
| Converter | toast と Command History |
| Form | toast と Command History |
| Viewer | viewer page 内の error message |

Command History には、action id、入力の概要、開始時刻、終了時刻、成功 / 失敗、保存先 path、error message を記録します。

Viewer error は preview 領域の中に表示し、検索バーや他の tab の操作を妨げないようにします。

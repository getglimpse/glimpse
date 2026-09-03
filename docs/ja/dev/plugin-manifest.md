# プラグイン Manifest 仕様ドラフト

`manifest.json` は plugin の主要な静的宣言です。Glimpse は install / discovery / trust / search indexing の前にこのファイルを検証します。

この文書は [plugin-spec.md](./plugin-spec.md) の分割先です。runtime の詳細は [plugin-runtime.md](./plugin-runtime.md)、page の詳細は [plugin-page.md](./plugin-page.md) を参照してください。

## 基本形

```json
{
  "id": "file-converter-plugin",
  "name": "File Converter",
  "version": "0.1.0",
  "apiVersion": "0.2.0",
  "author": "Glimpse Labs",
  "releaseDate": "2026-09-02",
  "description": "Convert local files.",
  "defaultLocale": "en",
  "i18n": "./i18n.json",
  "enabledByDefault": true,
  "page": "./page.json",
  "entrypoints": {
    "main": "./main.js"
  },
  "capabilities": {
    "files": {
      "read": "none",
      "write": "declared-output-directory"
    }
  },
  "settings": {
    "outputDirectory": {
      "type": "directory",
      "labelKey": "settings.outputDirectory.label",
      "labelFallback": "Output directory",
      "descriptionKey": "settings.outputDirectory.description",
      "descriptionFallback": "Directory where converted files are written.",
      "default": "downloads",
      "required": true
    }
  },
  "contributes": {
    "internalPage": {
      "id": "plugin:file-converter-plugin",
      "titleKey": "plugin.name",
      "titleFallback": "File Converter",
      "tags": ["internal", "plugin", "converter", "file"],
      "aliases": ["file converter", "converter plugin"]
    },
    "actions": [
      {
        "id": "convertFile",
        "titleKey": "actions.convertFile.title",
        "titleFallback": "Convert File",
        "descriptionKey": "actions.convertFile.description",
        "descriptionFallback": "Convert selected files.",
        "input": {
          "type": "file",
          "accept": ["*/*"],
          "multiple": true,
          "maxBytes": 52428800,
          "maxFiles": 20
        },
        "output": {
          "type": "file",
          "directorySetting": "outputDirectory"
        }
      }
    ],
    "viewers": []
  },
  "dependencies": {
    "plugins": []
  }
}
```

## 必須フィールド

| Field | Type | 説明 |
| --- | --- | --- |
| `id` | string | plugin directory name と一致する安定 ID。小文字英数字、`-`、`_`、`.` のみ。 |
| `name` | string | ユーザーに表示する名前。i18n では `plugin.name` を推奨します。 |
| `version` | string | semantic version triplet。例: `0.1.0`。 |
| `apiVersion` | string | この plugin が対象にする plugin API version。 |
| `page` | string | `page.json` への plugin root 相対パス。 |
| `entrypoints.main` | string | `main.js` への plugin root 相対パス。 |

## 任意フィールド

| Field | Type | 説明 |
| --- | --- | --- |
| `description` | string | plugin の概要。i18n では `plugin.description` を推奨します。 |
| `author` | string | plugin の制作者、または配布元。 |
| `releaseDate` | string | この version の発行日。`YYYY-MM-DD` 形式。 |
| `defaultLocale` | string | 既定 locale。`manifest.i18n` を指定する場合に使います。 |
| `i18n` | string | `i18n.json` への plugin root 相対パス。指定された場合だけ読み込みます。 |
| `enabledByDefault` | boolean | trust 後に既定で有効にするか。 |
| `capabilities` | object | plugin が必要とする権限。 |
| `settings` | object | plugin 固有設定の schema。 |
| `contributes` | object | Internal Page、action、viewer などの提供物。 |
| `dependencies` | object | 依存 plugin。`dependencies.npm` は reserved / future です。 |

`styles.css` は manifest field ではなく、plugin root に置ける任意ファイルです。

## capabilities

capability は最小権限で宣言します。宣言されていない capability は使えません。

```json
{
  "capabilities": {
    "files": {
      "read": "none",
      "write": "none"
    }
  }
}
```

File read scope:

| Scope | 説明 |
| --- | --- |
| `none` | ファイル読み取りなし。 |
| `active-tab` | viewer 実行時の active file のみ読み取り可能。 |
| `target-group` | current Target Group 配下のファイルを読み取り可能。 |

File write scope:

| Scope | 説明 |
| --- | --- |
| `none` | ファイル書き込みなし。 |
| `declared-output-directory` | `settings` で宣言された directory setting 配下にのみ書き込み可能。 |
| `target-group` | current Target Group 配下にのみ書き込み可能。通常は使わない。 |

ユーザーが plugin page にドロップ、または picker で選択した file input は `capabilities.files.read` とは別です。詳細は [plugin-runtime.md](./plugin-runtime.md#user-gesture-file-input) を参照してください。

## settings

`settings` は plugin 固有設定の schema です。形式は VS Code の settings schema に近い object にしますが、plugin author が書く key は dot-separated にせず、plugin 内で一意な plain key にします。

設定 UI は `page.json` に書きません。`manifest.settings` が 1 つ以上ある場合、Glimpse が Settings tab を自動追加します。

```json
{
  "settings": {
    "outputDirectory": {
      "type": "directory",
      "labelKey": "settings.outputDirectory.label",
      "labelFallback": "Output directory",
      "descriptionKey": "settings.outputDirectory.description",
      "descriptionFallback": "Directory where converted files are written.",
      "default": "downloads",
      "required": true
    },
    "overwriteExisting": {
      "type": "boolean",
      "labelKey": "settings.overwriteExisting.label",
      "labelFallback": "Overwrite existing files",
      "default": false
    }
  }
}
```

Setting key の規則:

- key は plugin 内で一意な plain key にします。例: `outputDirectory`。
- key は英数字で始め、英数字、`_`、`-` のみ使います。
- Glimpse は保存時に plugin ID で namespace します。Plugin author は manifest 内で plugin ID を key に重ねません。
- `labelKey` と `labelFallback` を指定します。
- `descriptionKey` と `descriptionFallback` は任意です。
- 実際の保存値は key ごとの value として保存します。

初期仕様で扱う setting type:

| Type | UI | Value |
| --- | --- | --- |
| `string` | text input | string |
| `directory` | text input + directory picker button | absolute directory path |
| `boolean` | switch | boolean |
| `number` | numeric input | number |
| `enum` | select / segmented control | string |

`directory` setting は手入力と picker の両方を許可します。picker button の既定ラベルは `Open` です。

### Settings validation

Settings validation は manifest schema validation と runtime value validation に分けます。

Manifest schema validation は install / discovery 時に実行します。

- setting key は `^[A-Za-z][A-Za-z0-9_-]*$` に一致する必要があります。
- `type` は `string`、`directory`、`boolean`、`number`、`enum` のいずれかです。
- `labelKey` と `labelFallback` を指定します。
- `descriptionKey` と `descriptionFallback` は任意です。
- `default` を指定する場合は `type` と一致する必要があります。
- `required` を指定する場合は boolean にします。
- `enum` は `options` を 1 件以上持ち、各 `options[].value` は string にします。
- `number` の `min`、`max`、`step` は number にし、`min` と `max` を両方指定する場合は `min <= max` にします。
- `directory` の `default` は `downloads`、`documents`、`desktop`、`target-group` のような Glimpse 定義の special value にします。

Runtime value validation は settings 保存時、action 実行前、file output 保存前に実行します。

- 保存済み値は schema の `type` と一致する必要があります。
- `required: true` の値が未設定で、default もない場合、その setting を参照する tab / action は実行できません。
- `enum` の値は `options[].value` に含まれる必要があります。
- `number` の値は `min`、`max`、`step` を満たす必要があります。
- `directory` の値は Glimpse が実 path に解決し、存在する directory であることを確認します。
- 不正な保存値は plugin action に渡さず、Settings tab で修正を促します。
- 無効化するのは問題の setting を参照する tab / action だけです。plugin 全体は無効化しません。

Default は次の順で解決します。

1. 保存済み user value
2. `manifest.settings` の `default`
3. Glimpse default
4. 未設定

Plugin action には validation 済みの settings だけを渡します。ただし `directory` setting は原則として plugin action に渡しません。File output の保存先は Glimpse が `output.directorySetting` から解決し、plugin は保存先 path を直接扱いません。

## contributes

`contributes` は Glimpse に登録する提供物です。

```json
{
  "contributes": {
    "internalPage": {
      "id": "plugin:file-converter-plugin",
      "titleKey": "plugin.name",
      "titleFallback": "File Converter",
      "tags": ["internal", "plugin"],
      "aliases": ["file converter"],
      "boost": 1
    },
    "actions": [],
    "viewers": []
  }
}
```

Internal Page:

- 初期仕様では 1 plugin は 1 page だけを持ちます。
- `contributes.internalPage` は単一 object です。複数 page の `internalPages` は持ちません。
- `internalPage.id` は `plugin:<plugin-id>` にします。
- Info page は manifest から自動生成されます。
- Info 以外の tab は `manifest.page` が参照する `page.json` に宣言します。

Action:

```json
{
  "id": "convertFile",
  "titleKey": "actions.convertFile.title",
  "titleFallback": "Convert File",
  "descriptionKey": "actions.convertFile.description",
  "descriptionFallback": "Convert selected files.",
  "input": {
    "type": "file",
    "accept": ["*/*"],
    "multiple": true,
    "maxBytes": 52428800,
    "maxFiles": 20
  },
  "output": {
    "type": "file",
    "directorySetting": "outputDirectory"
  }
}
```

Viewer:

```json
{
  "id": "csv",
  "titleKey": "viewers.csv.title",
  "titleFallback": "CSV Viewer",
  "descriptionKey": "viewers.csv.description",
  "descriptionFallback": "Preview CSV files.",
  "extensions": ["csv"]
}
```

## dependencies

初期仕様では plugin dependency だけを扱います。

```json
{
  "dependencies": {
    "plugins": [
      {
        "id": "shared-utils-plugin",
        "version": "^0.1.0"
      }
    ]
  }
}
```

`dependencies.npm` は reserved / future です。初期仕様では npm package の解決、install、bundle、更新は行いません。

## 配布形式

初期仕様の配布形式は folder です。

```text
<app-data-dir>/plugins/<plugin-id>/
|-- manifest.json
|-- main.js
|-- page.json
|-- i18n.json optional
`-- styles.css optional
```

Folder install では、plugin directory name と `manifest.id` が一致する必要があります。

`.glimpse-plugin.zip` は future feature とします。Zip 形式を追加する場合も、展開後の trust / fingerprint / schema validation は folder と同じ規則に従います。

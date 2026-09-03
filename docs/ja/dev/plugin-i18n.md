# プラグイン i18n 仕様ドラフト

表示文字列を locale ごとに定義したい場合は、独立した `i18n.json` を使います。`i18n.json` は任意で、`manifest.json` の `i18n` が指定された場合だけ Glimpse が読み込みます。

この文書は [plugin-spec.md](./plugin-spec.md) の分割先です。Manifest の詳細は [plugin-manifest.md](./plugin-manifest.md)、page の詳細は [plugin-page.md](./plugin-page.md) を参照してください。

## 基本形

`manifest.json`:

```json
{
  "defaultLocale": "en",
  "i18n": "./i18n.json"
}
```

`i18n.json`:

```json
{
  "en": {
    "plugin.name": "File Converter",
    "plugin.description": "Convert text files.",
    "tabs.converter.title": "Converter",
    "settings.outputDirectory.label": "Output directory",
    "settings.outputDirectory.description": "Directory where converted files are written.",
    "actions.convertFile.title": "Convert File"
  },
  "ja": {
    "plugin.name": "ファイル変換",
    "plugin.description": "テキストファイルを変換します。",
    "tabs.converter.title": "Converter",
    "settings.outputDirectory.label": "Output ディレクトリ",
    "settings.outputDirectory.description": "変換後のファイルを書き込むディレクトリです。",
    "actions.convertFile.title": "Convert File"
  }
}
```

`manifest.json` と `page.json` では literal fallback を持ちつつ key 参照できるようにします。

```json
{
  "titleKey": "tabs.converter.title",
  "titleFallback": "Converter"
}
```

## Fallback

標準タブで使う label は、次の順で解決します。

1. `i18n.json` の現在 locale の値
2. `i18n.json` の `manifest.defaultLocale` の値
3. `manifest.json` / `page.json` 内の literal fallback
4. Glimpse の既定 fallback

`manifest.i18n` がない plugin では、key 参照は解決せず literal fallback と Glimpse の既定 fallback だけを使います。

`manifest.i18n` を指定する場合、`manifest.defaultLocale` も指定することを推奨します。指定された `defaultLocale` が `i18n.json` に存在しない場合は discovery error とします。

## Validation

- `manifest.i18n` は任意です。指定する場合は plugin root 相対パスにします。
- `manifest.i18n` が指定されている場合、参照先の `i18n.json` が存在する必要があります。
- `manifest.defaultLocale` を指定する場合は、`i18n.json` の top-level key に存在する必要があります。
- `i18n.json` の top-level key は locale code にします。
- `manifest.defaultLocale` の辞書では、plugin が参照する key をすべて定義することを推奨します。
- その他の locale は部分翻訳を許可し、欠けた key は `defaultLocale` に fallback します。
- `defaultLocale` の key が欠けている場合は discovery warning にします。該当箇所は literal fallback を使います。
- その他 locale の key が欠けている場合は discovery warning にします。
- `titleKey`、`labelKey`、`descriptionKey` などの key 参照には、対応する `titleFallback`、`labelFallback`、`descriptionFallback` を持たせます。

## i18n key naming

`i18n.json` の key は flat な dot-separated key にします。Nested object は使いません。

予約 namespace:

| Namespace | 用途 |
| --- | --- |
| `plugin.*` | plugin name、description などの基本表示。 |
| `tabs.<tabId>.*` | plugin page tab の title、label。 |
| `settings.<settingKey>.*` | Settings tab の label、description。 |
| `actions.<actionId>.*` | action title、description、error。 |
| `viewers.<viewerId>.*` | viewer title、description。 |
| `errors.*` | plugin 共通 error message。 |
| `custom.<tabId>.*` | 将来の Custom tab 内だけで使う表示文字列。 |

Plugin author が任意に追加する key は `custom.<tabId>.*` 配下に置きます。標準 namespace の形に合わない top-level key は discovery warning とします。

# クエリ構文

Glimpse の検索バーでは、通常検索に加えていくつかの prefix を利用できます。

## 通常検索

```text
rust
```

タイトル、本文、タグ、aliases、その他インデックスされたテキストを検索します。複数語を入力すると結果を絞り込めます。

## タグ検索

`#` を付けるとタグ検索になります。

```text
#rust
```

通常の語句と組み合わせることもできます。

```text
async #rust
```

## Global Search

`*` を付けると、現在の Target Group だけでなく、すべての Target Groups を検索します。

```text
*rust
```

## Hidden Search

`!` を付けると、`hidden: true` のアイテムを検索します。

```text
!rust
```

Hidden Search では、通常表示されるアイテムではなく hidden item が検索結果に表示されます。必要に応じて Global Search と組み合わせます。

すべての Target Groups の hidden item を検索する場合:

```text
*!rust
```

## Internal Pages

`:` を付けると、組み込み Internal Pages や信頼済みプラグインページを検索します。

```text
:settings
:help
:plugin
```

Internal Pages は検索結果に表示され、ドキュメントと同じように Preview できます。

`/` を付けると plugin playground page だけを検索します。

```text
/calculator
```

## 引数

`>` を使うと、選択したアイテムへ引数を渡せます。

```text
numeric calculator > 1 + 2
```

コマンドランチャーの場合:

```text
Git > status
```

`>` の右側の文字列が、`Enter` 実行時に引数として渡されます。

## Summary

| Query                        | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `rust`                       | 現在の Target Group を検索                   |
| `#rust`                      | タグ検索                                     |
| `*rust`                      | すべての Target Groups を検索                |
| `!rust`                      | hidden item を検索                           |
| `*!rust`                     | すべての Target Groups の hidden item を検索 |
| `:settings`                  | Internal Pages を検索                        |
| `/plugin`                    | plugin playground page を検索                |
| `numeric calculator > 1 + 2` | 選択したページやアクションへ引数を渡す       |

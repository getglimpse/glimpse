# クエリ構文

Glimpse の検索バーでは、通常検索に加えていくつかの prefix を利用できます。

## 通常検索

```text
rust
```

現在の Target Group 内で、タイトル、本文、タグ、aliases などの indexed text を検索します。複数語を入力すると結果を絞り込めます。

## タグ検索

`#` を付けるとタグ検索になります。

```text
#rust
```

通常の語句と組み合わせることもできます。

```text
async #rust
```

## Hidden Search

`!` を付けると、`hidden: true` の item だけを検索します。

```text
!rust
```

Hidden Search も現在の Target Group 内だけを対象にします。

## Internal Pages

`:` を付けると、組み込み Internal Pages や trusted plugin pages を検索します。

```text
:settings
:help
:plugin
```

`/` を付けると plugin playground page だけを検索します。

```text
/calculator
```

## 引数

`>` を使うと、選択した item に引数を渡せます。

```text
numeric calculator > 1 + 2
Git > status
```

`>` の右側は、`Enter` 実行時に引数として渡されます。

## Summary

| Query                        | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `rust`                       | 現在の Target Group を検索                   |
| `#rust`                      | タグ検索                                     |
| `!rust`                      | hidden item を検索                           |
| `:settings`                  | Internal Pages を検索                        |
| `/plugin`                    | plugin playground page を検索                |
| `numeric calculator > 1 + 2` | 選択した page/action に引数を渡す            |

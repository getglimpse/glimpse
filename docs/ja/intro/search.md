# 検索の基本

Glimpse は、入力に合わせて検索結果と Preview をリアルタイムに更新します。

検索ボタンはありません。数文字入力し、矢印キーで結果を移動し、Preview で内容を確認してから開きます。

## 基本フロー

アプリ使用の基本フローは下記になります。

<img class="diagram diagram-xs" src="../../assets/diagrams/intro_1.svg" alt="Basic search workflow">

1. Type a query: 検索バーに数文字入力します。
2. Search Results: リアルタイムに更新される検索結果を確認します。
3. Live Preview: 選択中 item を開かずに内容確認します。
4. Preview Tabs: 残したい preview を固定します。
5. Continue searching: query の調整や Target Group の切り替えを続けます。

検索結果を選択すると、Live Preview パネルが自動で更新されます。

Live Preview を固定するには、設定済みの `Add Preview Tab` ショートカットを使用します。
デフォルトは `Ctrl + T` ですが、ショートカットは設定ページで変更可能です。

## 通常検索

```text
rust
```

通常検索では、タイトル、本文、タグ、aliases、その他インデックスされたテキストを検索します。

検索対象の例:

- Markdown ファイル
- `.gjson` の検索アイテム
- 画像や metadata-only file reference
- Raw file preview
- 組み込み Internal Pages
- 信頼済みプラグインのページやアクション

## Live Preview

検索結果を選択すると、別のアプリを開かずに Preview パネルが更新されます。

```text
Search Results       Preview

Rust          ->      Rust.md
Markdown      ->      Markdown.md
Commands      ->      Commands.md
```

開く前に、対象のファイル、外部 URL、コマンド、プラグインアクションが正しいか確認しやすくなります。

## Preview Tabs

現在の Preview を残しておきたい場合は、次のショートカットを押します。

```text
Ctrl + T
```

現在の Preview が Preview Tab として追加されます。Live Preview は選択中の検索結果に追従し続け、Preview Tabs は閉じるまで残ります。

## 検索構文

| 入力                         | 説明                                         |
| ---------------------------- | -------------------------------------------- |
| `rust`                       | 現在の Target Group を検索                   |
| `#rust`                      | タグ検索                                     |
| `!rust`                      | hidden item を検索                           |
| `:settings`                  | Internal Pages を検索                        |
| `/plugin`                    | plugin playground page を検索                |
| `numeric calculator > 1 + 2` | 選択したページやアクションへ引数を渡す       |

詳しい構文は [クエリ構文](../search/syntax.md) を参照してください。

## Internal Pages

Internal Pages は `:` で検索します。

```text
:settings
:help
:plugin
```

Internal Pages は検索結果に表示され、ドキュメントと同じように Preview できます。

## Target Groups

検索対象は Target Groups で管理します。

`Ctrl + R` を押すと、現在の検索クエリを保ったまま次の Target Group に切り替えます。


## Search Tips

1. 検索バーに数文字入力します。
2. 矢印キーで検索結果を移動します。
3. Live Preview で内容を確認します。
4. 残しておきたいドキュメントは `Ctrl + T` で Preview Tab にします。
5. 別の Target Group にある可能性がある場合は、`Ctrl + R` を使います。

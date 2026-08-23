# Target Groups

Target Groups は、検索対象フォルダーを用途ごとに分けて管理する機能です。

通常検索は、現在アクティブな Target Group を対象に実行されます。

## 例

```text
Work
  ~/Projects
  ~/Documents/Work

Personal
  ~/Documents/Notes

Study
  ~/Documents/Study
```

## 作成

**Settings -> Target Groups** から作成します。

1. Group name を入力する
2. 検索対象フォルダーを追加する
3. 保存する

## 切り替え

`Ctrl + R` を押すと、次の Target Group に切り替わります。

検索クエリはそのまま維持されます。

## Global Search

`*` を付けると、すべての Target Groups を検索します。

```text
*rust
```

## 対応ファイル

Target Group には Markdown、`.gjson`、画像、その他ファイルを含められます。

```text
Work
  API.md
  Meeting.md
  links.gjson
  tools.gjson
  diagram.png
```

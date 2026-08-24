# Target Groups

Target Groups は、検索対象フォルダーを用途ごとに分けて管理するための機能です。

通常検索は、現在の Target Group だけを対象にします。

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

`Ctrl + R` を押すと、次の Active Target Group に切り替わります。

検索クエリはそのまま維持されるため、同じ query で別の Target Group を探せます。

## 対応ファイル

Target Group には Markdown、`.gjson`、画像、その他のファイルを含められます。

```text
Work
  API.md
  Meeting.md
  links.gjson
  tools.gjson
  diagram.png
```

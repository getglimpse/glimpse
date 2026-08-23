# Internal Pages

Internal Pages は、Glimpse の検索結果に表示されるアプリ内ページです。

`:` を付けて検索します。

```text
:settings
:help
:plugin
```

通常のドキュメントや `.gjson` item と同じように、Preview パネルで表示したり Preview Tab に固定したりできます。

## 利用できるページ

| Page            | 説明                                             |
| --------------- | ------------------------------------------------ |
| Help            | 使い方のヘルプを表示する                         |
| Settings        | アプリ設定を管理する                             |
| Shortcuts       | キーボードショートカットを表示する               |
| About           | バージョンやライセンス情報を表示する             |
| Debug           | インデックスや実行状態の診断情報を表示する       |
| Command History | コマンドやプラグインアクションの履歴を表示する   |
| Plugin Page     | ローカルプラグインをインストール、信頼、管理する |

信頼済みプラグインも Internal Pages を追加できます。

## 引数

プラグイン提供の Internal Page は、page action を定義している場合に `>` で引数を受け取れます。

```text
numeric calculator > 1 + 2
```

検索結果で対象ページを選択し、`Enter` を押すと実行されます。

## In-App Help

対応している Internal Page では、`Ctrl + H` で使い方を確認できます。

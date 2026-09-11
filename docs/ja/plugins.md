# プラグイン

Glimpse はローカルプラグインとリモートプラグインで拡張できます。

プラグインは、検索できるページ、アクション、ファイルビューアーを追加できます。たとえば、計算ページ、変換ページ、Glimpse が標準では扱わないファイル形式のプレビューなどを追加できます。

## Plugin Page を開く

検索バーから Plugin Page を開けます。

```text
:plugin
```

Plugin Page では、プラグインのインストール、信頼、有効化、無効化、削除を行います。インストール済みプラグインに `README.md` が含まれている場合は、Plugin Page の詳細から README を確認できます。

リモートプラグインは、Plugin Store に分けて表示されます。Glimpse は公式 registry が指す `.glimpse-plugin.zip` をダウンロードし、SHA-256 checksum を検証してからインストールします。

## リモートプラグインをインストールする

リモートプラグインは Plugin Store に表示されます。

```text
plugin store
```

1. 検索から Plugin Store を開きます。
2. インストールしたいプラグインを探します。
3. 詳細を開き、リポジトリ、説明、README を確認します。
4. Install を押します。インストール済みで registry 側に新しい version がある場合は Update を押します。
5. 内容と配布元を理解している場合だけ Enable を押します。

Plugin Store では、インストール済みのリモートプラグインを同じ詳細画面から有効化、無効化、アンインストールできます。信頼されていないリモートプラグインを Enable すると、現在インストールされているファイルに対する trust を記録してから有効化します。

リモートプラグインも、ローカルプラグインと同じ trust boundary で扱われます。Trust するまで Glimpse は `main.js` を実行しません。プラグインをインストールまたは更新すると、以前の trust record は解除されます。

Plugin Store に表示される author は、プラグインの repository URL に含まれる GitHub repository owner から導出されます。ダウンロード数は optional です。Glimpse が数値を持っていない場合、cloud download icon の横には `-` が表示されます。

## ローカル archive をインストールする

Plugin Page では、ローカルの `.glimpse-plugin.zip` もインストールできます。ページメニューから local install dialog を開き、archive path を追加、または drop して、plugin folder と同じ流れでインストールします。

ローカル archive もリモートダウンロードと同じ検証を受けます。registry 経由でないため checksum 検証は行いませんが、archive layout、許可 file set、path traversal、実行ファイル、archive size limit は検証されます。

## 信頼

プラグインは自動では読み込まれません。インストール後、Glimpse がコードを実行する前にユーザーが信頼する必要があります。

内容と配布元を理解しているプラグインだけを信頼してください。プラグインを差し替えたり、ファイルが変更されたりすると trust record は解除され、再度確認できます。`README.md` はレビュー用の資料として trust 前にも表示されることがありますが、Enable するまで Glimpse はプラグインコードを実行しません。

registry は、ダウンロード先と期待する checksum を Glimpse に伝えるものです。ユーザーの trust 判断を置き換えるものではありません。checksum はダウンロード内容の変化を検出できますが、そのプラグインが安全であることや、実行してよいことまでは証明しません。

## 使い方

信頼済みプラグインは、組み込みの Internal Page と同じように検索結果へ表示されます。

一部のプラグインページは `>` で引数を受け取れます。

```text
numeric calculator > 1 + 2
```

Viewer plugin は、対応するファイル形式のプレビューも追加できます。信頼済み viewer が選択中のファイルに一致する場合、Glimpse は Preview パネルでそのファイルを表示できます。

## プラグインを作る場合

ユーザードキュメントでは、プラグインが Glimpse 上でどう見えるかだけを説明します。Plugin API の具体仕様と author 向けメモは `getglimpse/plugin-template` で管理します。無料公開 plugin と公式 registry は `getglimpse/plugins` で管理します。

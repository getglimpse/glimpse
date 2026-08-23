# インストール

Glimpse のインストール方法を説明します。

## 動作環境

現在確認している環境:

- Windows 11
- Fedora Linux

Windows、macOS、Linux で動作するように設計していますが、macOS はまだ十分に検証していません。

## ダウンロード

最新ビルドは GitHub Releases からダウンロードできます。

### Windows

Windows ではインストーラーを使用します。

```text
Glimpse_x.x.x_x64-setup.exe
```

### Linux

Debian / Ubuntu 系では `.deb` パッケージを利用できます。

```text
Glimpse_x.x.x_amd64.deb
```

インストール例:

```bash
sudo dpkg -i Glimpse_x.x.x_amd64.deb
```

依存関係のエラーが出た場合:

```bash
sudo apt install -f
```

## 初回起動

初回起動時、Glimpse は Documents フォルダー内に既定のワークスペースを作成します。

```text
Glimpse/
|-- Welcome.md
|-- Getting Started.md
|-- Markdown.md
|-- Metadata.md
|-- Commands.md
`-- Examples/
```

これらのファイルは、検索、プレビュー、Markdown、メタデータの基本を試すためのサンプルです。

## 更新

新しいバージョンへ更新する場合は、最新のインストーラーまたはパッケージをインストールしてください。

設定、ワークスペース、検索インデックスは通常そのまま保持されます。

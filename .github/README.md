# GitHub Actions（開発者向け）

| ワークフロー | 実行タイミング | 内容 |
| --- | --- | --- |
| [`rust-tests.yml`](workflows/rust-tests.yml) | `src-tauri/**` またはワークフロー自身を変更した PR・`main` への push、手動実行 | Linux・Windows・macOS で Rust の書式とテストを確認 |
| [`release.yml`](workflows/release.yml) | `v*` タグの push、タグを指定した手動実行 | フロントエンドの検証後、各 OS のアプリをビルドしてドラフト Release に添付 |
| [`docs.yml`](workflows/docs.yml) | `v*` タグの push、手動実行 | ドキュメントをビルドして GitHub Pages に公開 |

`v*` タグを push すると Release と Docs の両方が実行されます。Docs の手動実行も公開を伴います。起動条件や手順の詳細は各ワークフローの YAML を正本としてください。

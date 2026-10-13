# workbench

小さなツールを作って置いておくためのリポジトリです。ツールごとにディレクトリを分けています。

| ツール | 説明 | ダウンロード |
| --- | --- | --- |
| [Shelf](shelf/) | ファイルを移動するときの一時置き場になる、Yoink 風の小さなアプリ（macOS / Windows） | [Releases](https://github.com/2204601/workbench/releases?q=shelf) |
| [Clip](clip/) | メールアドレスや電話番号などのよく使う文字と、コピーの履歴を、ショートカット 1 つで呼び出して入力するアプリ（macOS / Windows） | [Releases](https://github.com/2204601/workbench/releases?q=clip) |
| [Renamer](renamer/) | フォルダの中のファイル名を、ルールに沿って一括で変えるアプリ。プレビューと取り消し付き（Windows / macOS） | [Releases](https://github.com/2204601/workbench/releases?q=renamer) |
| [Disk Analyzer](disk-analyzer/) | ドライブやフォルダの中で何が容量を使っているかを、DaisyDisk 風のグラフ（サンバースト・ツリーマップ・アイシクル）と一覧で見るアプリ（Windows / macOS） | [Releases](https://github.com/2204601/workbench/releases?q=disk-analyzer) |
| [Meter](meter/) | CPU・メモリ・ディスク・ネットワークの使用状況をタスクトレイ（macOS はメニューバー）にいつも出し、クリックでグラフと重いアプリの一覧を見るアプリ（Windows / macOS） | [Releases](https://github.com/2204601/workbench/releases?q=meter) |
| [Video Studio](video-studio/) | 動画を切って並べ、文字やスタンプ、切り替えのアニメーションを入れて MP4 に書き出す、かんたんな動画編集アプリ（Windows / macOS） | [Releases](https://github.com/2204601/workbench/releases?q=video-studio) |

## リポジトリの決まりごと

- ツールは `<名前>/` ディレクトリにまとめ、使い方と開発手順はそのディレクトリの `README.md` に書きます
- CI はツールごとに `.github/workflows/<名前>.yml` を置き、そのディレクトリが変わったときだけ動くようにします
- リリースのタグは `<名前>-v<バージョン>`（例: `shelf-v0.1.1`）です
- アプリ内アップデートの配信には、ツールごとの固定のリリース `<名前>-updater`（例: `shelf-updater`）を使います。`releases/latest` は他のツールのリリースと取り合いになるためです

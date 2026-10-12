# ロードマップ

## v0.1.0 までのマイルストーン

各マイルストーンの終わりに Platform Governance §4 の gate（tsc、lint、fmt、clippy、cargo test）が通っていること。

### M0 雛形 ✅

**署名鍵**：workbench に入れたので、workbench の Secrets（Shelf と同じ鍵）で署名する。公開鍵は Shelf と同じ値を `pubkey` に入れた。


- 雛形を置く。Platform の [新しいツールを作る](../../../desktop-platform/playbook/new-tool.md) §1「desktop-base がまだ無いとき」の表に従い、stockroom の `170b90c`（v0.17.0）から写す。写した commit は `decisions/project-context.md` にある
  - `identifier` は `jp.co.jazmf.renamer`、`productName` は `Renamer`
  - stockroom 固有の文字列を直す：`src-tauri/src/proxy.rs` の PAC のモード名（`StockroomPAC`）と User-Agent、`src/lib/update.ts` の `FEED` と「最新版です」の文言、`tauri.conf.json` の `plugins.updater.endpoints`
  - 使わないものは写さない：ローカル受付（`loopback.rs`、`mcp/`、`webimport.rs`、`extension/`）、SQLite（`db.rs`、`library.rs`）、画像・フォント・PDF の処理、asset protocol
- updater の署名鍵：workbench の Secrets を使う（Shelf と共有）
- `app-icon.svg` とアイコンの生成
- plugin の配線：log、single-instance、window-state、dialog、opener、notification、process、updater
- CSP、capabilities を使う分だけ
- CI：Linux で test と lint、macOS / Windows でビルド
- `CLAUDE.md`、README の「機能」「開発」「構成」、CHANGELOG の `## 0.1.0`

### M1 読み込みと一覧 ✅

1 万件の読み込み 39 ms、一覧 9 ms（Linux、ローカル、release）。ネットワーク上での確認は M4。


- `scan`（フォルダ直下、ファイルの追加、除外、ネットワーク判定、進捗と中止）
- 一覧の仮想スクロール、絞り込み、並び順、行のチェック
- `mockBackend.ts` で UI をブラウザだけで作れるようにする
- `examples/seed.rs` で 1 万件を作り、読み込みで固まらないことを確かめる

### M2 ルールとプレビュー ✅

1 万件に正規表現の置換をかけて 68 ms。1 万件が連鎖して全部ぶつかる場合も線形で調べる。


- ルール 4 種の計算（Rust）とフォーム（簡単・詳細）
- 検査：Windows 基準、衝突（NFC + 大文字小文字、絞り込みで外れたファイルも含める）
- 状態の表示、「問題のある行をすべて外す」、ステータスバーの集計
- ここまでで「ファイルは変えないが結果は全部見える」状態になる

### M3 実行と取り消し ✅

実行と取り消しは、Linux の実ファイルと Tauri のモックランタイム（`tests/ipc.rs`）で確かめた。Windows では CI の `test-windows` が同じテストを NTFS で回す。macOS の `renamex_np` は CI のビルドだけで、実機の確認は M4。


- 上書きしないリネーム（Windows / macOS / Linux）
- 実行の順番と 2 段階（入れ替え、大文字小文字だけ、NFC だけ）
- ジャーナル、途中で失敗したときの選択肢、中止、起動時の復旧
- 元に戻す（確かめ直し、戻せなかったものの一覧）
- `Fs` trait の偽物を使った失敗のテスト

### M4 ネットワークと性能の確認

自動テストでは確かめにくいので、実機で次を行い結果を `docs/` に残す。

- [ ] 社内 NAS（`\\...`）とドライブ文字を割り当てた共有フォルダで、1,000 件の実行と取り消し
- [ ] 実行中に LAN を抜く → 止まって、戻せる
- [ ] ほかの PC で Excel を開いたファイルを含めて実行 → ロック中と表示され、飛ばして続けられる
- [ ] Mac で作った NFD の名前を Windows から NFC にそろえる
- [ ] OneDrive の同期フォルダ（オンライン専用のファイルを含む）で実行 → ダウンロードが起きない
- [ ] ローカルで 1 万件の読み込み・プレビュー・実行の時間
- [ ] 実行中にアプリを強制終了 → 次の起動で戻せる

### M5 v0.1.0 リリース

Platform の [新しいツールを作る](../../../desktop-platform/playbook/new-tool.md) §5 の checklist を通す。Windows でのインストールと起動を先に、macOS も一度確かめる。

## 第 2 版以降

| 機能 | 備考 |
|---|---|
| Excel / CSV の対応表でリネーム | 一覧を CSV で書き出す → Excel で編集 → 読み込んで実行。Excel が出す Shift_JIS と UTF-8（BOM 付き）の両方を読む |
| サブフォルダを含める | walkdir。フォルダをまたぐ衝突の検査 |
| 手で並べ替えて連番 | pointer イベントで実装（Platform UI §6） |
| EXIF の撮影日時 | 画像を読むので Security §4「外から来るファイル」の扱いが要る |
| エクスプローラーの右クリック | Windows のシェル拡張かコマンドライン引数 |

## 未決事項

| # | 内容 | 決める時期 |
|---|---|---|
| 1 | **確認に使う NAS**。社内の共有フォルダの種類（Windows Server、Samba、市販の NAS）と、試してよいフォルダ | M4 の前 |
| 2 | **macOS の確認**。社内に Mac がほぼ無いので、誰がどの機械で確かめるか | M5 の前 |
| 3 | 除外するファイルを設定で表示できるようにするか（[SPEC.md](SPEC.md) §4）。Rust の `add_paths` は `includeHidden` を受け取れる。画面は未定 | v0.1.0 の後でもよい |

# 設計

Platform の [Architecture Standard](../../../desktop-platform/standards/architecture.md) に沿う。ここにはこのツール固有の境界だけを書く。振る舞いは [SPEC.md](SPEC.md)、事故を防ぐ仕組みは [SAFETY.md](SAFETY.md)。

## 1. 方針

- **新しい名前の計算と検査は Rust 側だけで行う**。フロントは計算しない。
  - 正規表現の書式を 1 つ（Rust `regex`）にそろえる。JavaScript と Rust で結果がずれない。
  - 1 万件の計算を rayon で並列にでき、`cargo test` で厚くテストできる。
- 計算は副作用の無い純粋関数にし、ファイルシステムに触るのは `scan` と `execute` / `undo` だけにする。
- 読み込んだ一覧は Rust 側が持ち、フロントはプレビューの結果だけを持つ（Platform Stack「Rust 側の状態と二重に持たない」）。

## 2. 層

| 層 | 中身 |
|---|---|
| shell | proxy、updater、log の配線、single-instance、window-state、settings.json（stockroom から写す。desktop-base ができたら差し替える） |
| core | 読み込み、プレビューの組み立て、名前の検査、実行の計画、実行と取り消し、ジャーナル |
| features | ルール 4 種（置換、連番、日付、整形）。Rust の計算とフロントのフォームを対にする |

## 3. ディレクトリ

```text
renamer/
  src/
    App.tsx                 レイアウト、OS からのドロップ
    store.ts                モード、ルールの下書き、絞り込み、プレビューの結果、チェック、進行中の処理
    lib/api.ts              Rust コマンドの型付きラッパ
    lib/commands.ts         コマンド表
    lib/actions.ts          確認ダイアログを伴う操作（実行、元に戻す）
    components/             一覧（仮想スクロール）、ツールバー、ステータスバー、トースト
    features/
      replace/              置換のフォーム（簡単・詳細）
      number/               連番・テンプレート
      date/                 日付
      normalize/            整形
    dev/mockBackend.ts      ブラウザ開発用モック
  src-tauri/src/
    lib.rs                  plugin の配線、setup、invoke_handler
    commands.rs             フロントから呼ぶコマンド
    scan.rs                 フォルダの読み込み、除外、ネットワーク判定
    preview.rs              ルールを適用して新しい名前を作る（並列）
    validate.rs             Windows 基準の検査、衝突の検査（NFC + 大文字小文字）
    plan.rs                 実行の順番、入れ替えと 2 段階の判定（純粋関数）
    execute.rs              実行と取り消し（`Fs` trait 経由、テストで失敗を起こせる）
    journal.rs              ジャーナルの読み書き
    fs_os.rs                上書きしないリネーム、エラーの翻訳（cfg(target_os) で分ける）
    rules/
      mod.rs                Rule の enum と共通の型（拡張子の切り分け）
      replace.rs            置換（文字列、正規表現）
      template.rs           連番と日付のテンプレート（{name} {n:3} {mdate:yyyyMMdd}…）
      normalize.rs          整形（全角半角、半角カナ、大文字小文字、空白、使えない文字、NFC）
    natural.rs              自然順（"2" が "10" より前）
    examples/seed.rs        1 万件のテスト用ファイルを作る
  docs/                     SPEC.md、ARCHITECTURE.md、SAFETY.md、ROADMAP.md
  decisions/                project-context.md、ADR
```

## 4. コマンド

| コマンド | 引数 | 戻り値 | 備考 |
|---|---|---|---|
| `add_paths` | フォルダ or ファイルのパス、置き換えるか（`null` はドロップ：フォルダがあれば置き換え）、隠しファイルを含めるか | 件数、除いた数、読めなかったもの | `scan-progress` イベント、中止可。中止したら一覧は前のまま |
| `list_files` | 絞り込み、並び順、外した行（M2 でルール、拡張子の扱い） | 行の一覧（ID、元の名前、新しい名前、状態、理由）と集計（拡張子ごとの件数、フォルダとネットワーク判定） | フロントが古い問い合わせの答えを捨てる |
| `clear_files` | なし | なし | |
| `run_rename` | `list_files` と同じ問い合わせ | `completed`（件数）か `stopped`（件数、残り、失敗した 1 件と理由） | 問題のある行があれば断る。Rust 側で一覧を計算し直してから実行する。`run-progress` イベント、中止可。止まった実行は `AppState.run` に残る |
| `resume_rename` | 失敗した 1 件を飛ばすか | `run_rename` と同じ | 止まった実行を続ける |
| `finish_rename` | なし | 一時的な名前のまま残ったファイル | 止まった実行をここで終える（変更した分はそのまま、元に戻せる）。途中のファイルは元の名前へ。起動時の「このままにする」もこれ |
| `undo_rename` | なし | 戻した数、戻せなかったものの一覧 | ジャーナルから戻す（アプリを閉じた後でも）。`run-progress` イベント |
| `journal_status` | なし | 元に戻せるか、途中で終わったか、件数 | ⌘Z の可否と、起動時の問い合わせ |
| `cancel_task` | なし | なし | 実行中の処理（1 度に 1 つ）を次の確認点で止める |

- 引数と戻り値は `serde`（`rename_all = "camelCase"`）。エラーは日本語の `String`。
- コマンドは `Runtime` に対して汎用にし、`src-tauri/tests/ipc.rs` で Tauri のモックランタイムから JS と同じ引数で呼んで確かめる。
- 長い処理（読み込み、実行、取り消し）は `spawn_blocking` で走らせ、1 度に 1 つだけ（`AppState.busy`）。読み込みは一覧の写しに読み込んでから差し替えるので、その間も一覧は問い合わせられる。
- ルールは Rust の `enum Rule { Replace, Insert, Trim, Template, Normalize }`（`kind` で判別）で、TypeScript 側も同じ形の判別共用体にする。画面の 4 つのタブ（置換・連番・日付・整形）は `src/lib/ruleDraft.ts` がこのどれかに組み立てる。連番と日付はどちらも `Template`。
- ルールが書式として正しくないとき（正規表現の途中など）は `ruleError` に理由を入れ、行は名前を変えずに返す。フロントは前の結果を表示したままにする。
- プレビューの行は 1 万件でも 1 回で返す（1 行 200 バイトとして 2 MB 程度）。重ければ表示範囲だけを返す形に変える。

## 5. フロントの状態（zustand）

| 状態 | 中身 |
|---|---|
| `mode` | `simple` / `detail`（`localStorage` にも覚える） |
| `ruleKind`、`ruleDraft` | 選んでいるルールと入力中の値 |
| `filter`、`sort`、`view` | 絞り込み、並び順、表示（すべて / 変わるもの / 問題） |
| `rows`、`summary` | `preview` の結果をそのまま置く |
| `unchecked` | チェックを外した行の ID |
| `job` | 進行中の処理（種類、進捗、中止できるか） |
| `lastRun` | 元に戻せる実行があるか |

## 6. 依存

Platform の Recommendations にあるもの：Tauri 2、React 19、zustand、Tailwind 4、lucide-react、`@tanstack/react-virtual`、rayon、uuid、tempfile（テスト）、`windows`。
plugin：dialog、log、notification、opener（エクスプローラーで表示）、process、updater、window-state、single-instance。drag、fs、store は使わない。ファイル操作は Rust のコマンドで行うので fs plugin は要らない。

**Recommendations に無いもの**（追加前に健全性チェックを行って提示する。Platform Governance §3）：

| crate | 用途 | 代わりの案 |
|---|---|---|
| `regex` | 置換の正規表現 | なし（事実上の標準）。Tauri の依存で既に入っていた |
| `unicode-normalization` | NFC | なし。新規 |
| `libc` | macOS の `statfs`（M1）、`renamex_np`、Linux の `renameat2`（M3） | `nix` |
| `chrono`（`clock` のみ） | 日時をローカル時刻に変える | 書式は自前（yyyy MM dd HH mm ss だけ）。Tauri の依存で既に入っていた |

全角・半角の変換と自然順は、表が小さいので自前で書く（案）。

## 7. capabilities と CSP

- `core:default`、`dialog:default`、`notification:default`、`opener:default`（表示のみ）、`process:allow-restart`、`updater:default`、`window-state:default`。
- asset protocol は使わない（サムネイルを出さない）。
- CSP は Platform Security §1 の既定のまま。

## 8. テスト

| 対象 | 方法 |
|---|---|
| ルール 4 種、テンプレート、日付の書式、整形 | 純粋関数のユニットテスト。日本語の例を多めに |
| 検査（予約名、禁止文字、長さ、NFC と大文字小文字の衝突） | ユニットテスト |
| 実行の順番（連鎖、輪、大文字小文字だけ） | ユニットテスト。乱数で作った名前の組で「最終的な名前が期待どおり」「途中で行き先が埋まっていない」を確かめる |
| 実行と取り消し | `tempfile` のフォルダで結合テスト。`Fs` trait の偽物で N 件目に失敗させ、戻せることを確かめる |
| 途中で落ちた後の復旧 | ジャーナルを途中まで書いた状態から `undo` |
| 大文字小文字を区別しないファイルシステム | CI の Linux は区別するので、Windows の runner でも `cargo test` を回す（案） |
| 性能 | `examples/seed.rs` で 1 万件を作り、読み込み・プレビュー・実行の時間を測る |
| ネットワーク | 自動では難しいので、[ROADMAP.md](ROADMAP.md) M4 の手順で実機で確かめる |

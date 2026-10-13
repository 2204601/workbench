# Video Studio

動画を切って並べ、文字・スタンプ・切り替えを入れて MP4 に書き出す、かんたんな動画編集アプリ（Tauri 2 / Windows・macOS）

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.2.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。

## このツール固有

- 機能仕様：`docs/SPEC.md`。設計の境界：`docs/ARCHITECTURE.md`
- **編集の状態はフロントだけが持つ**。Rust は ffmpeg を動かすだけ（probe、下ごしらえ、書き出し）
- **プレビューと書き出しの見た目を合わせる**。次のものは対になっている。片方を変えたら、もう片方とテストも同じ PR で変える
  - `src/lib/anim.ts` ↔ `src-tauri/src/render.rs` の `overlay_exprs`（`anim.test.ts` と `overlays_animate_with_expressions`）
  - `src/lib/transitions.ts` ↔ ffmpeg の `xfade`（`render.rs` の `TRANSITIONS`。新しい種類は ffmpeg で向きを確かめてから）
  - `src/lib/timeline.ts` の `layout` ↔ `render.rs` の `frames`（同じ例のテスト）
  - `src/lib/api.ts` の `ExportJob` ↔ `render.rs` の `ExportJob`（`tests/ipc.rs`）
- 素材のファイルは読むだけ。書くのはユーザーが選んだ `.cutter` と `.mp4`、キャッシュ、設定、ログだけ
- ffmpeg に渡す文字列は `render.rs` で組み立て、名前は許したものだけ、数字は有限の値だけ。シェルは通さない
- 同梱の ffmpeg の版を変えるときは `scripts/fetch-ffmpeg.mjs` の RELEASE と SHA-256、README「ffmpeg について」、decisions を一緒に直し、`npm test`（本物の ffmpeg で書き出すテストがある）を通す
- 操作はコマンド表 `src/lib/commands.ts` にまず足す
- Rust コマンドは `src/lib/api.ts` のラッパ経由で呼ぶ。モック `src/dev/mockBackend.ts` も同じ PR で更新する
- zustand の selector で関数・配列・オブジェクトを新しく作って返さない（無限に再描画する）

## コマンド

```bash
npm install
npm run ffmpeg         # 同梱の ffmpeg を取ってくる（初回）
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック）
npm test               # cargo test + tsc --noEmit + vitest
npm run lint
npm run tauri build    # 配布用ビルド（署名鍵が要る。README「リリース」）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、CSP の緩和、capabilities の追加、asset protocol の scope（空のまま。素材は `probe_media` で 1 つずつ許す）は人の判断なしに変えない。

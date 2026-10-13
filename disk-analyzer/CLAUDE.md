# Disk Analyzer

ドライブやフォルダの中で何が容量を使っているかを、グラフ（サンバースト・ツリーマップ・アイシクル）と一覧で見るデスクトップアプリ（Tauri 2 / Windows・macOS）

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.2.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。

## このツール固有

- 機能仕様：`docs/SPEC.md`。設計の境界：`docs/ARCHITECTURE.md`
- **見るだけのアプリ**。ファイルを消す・動かす・名前を変える機能は、人の判断なしに足さない（docs/SPEC.md §1）
- スキャンしたツリーは Rust 側だけが持つ。集計・並べ替え・小さい項目のまとめは Rust 側（`view.rs`）で行い、ツリーを丸ごとフロントへ送らない
- 大きさの数え方（リンク、クラウドのみ、ハードリンク、別のボリューム）を変えるときは `scan.rs` のテストを足し、README「容量の数え方」も直す
- 操作はコマンド表 `src/lib/commands.ts` にまず足す
- Rust コマンドは `src/lib/api.ts` のラッパ経由で呼ぶ。モック `src/dev/mockBackend.ts` も同じ PR で更新する
- グラフの色の順番（`src/index.css` の `--color-s1`〜`s8`）は色覚の検証を通した順。入れ替えない

## コマンド

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック）
npm test               # cargo test + tsc --noEmit
npm run lint
npm run tauri build    # 配布用ビルド（署名鍵が要る。README「リリース」）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、CSP の緩和、capabilities の追加は人の判断なしに変えない。

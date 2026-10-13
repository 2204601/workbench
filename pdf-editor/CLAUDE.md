# PDF Editor

PDF を見る・ページを整理する・書き込む・フォームに入力するデスクトップアプリ（Tauri 2 / Windows・macOS）。目標は Acrobat

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.2.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。

## このツール固有

- 機能仕様：`docs/SPEC.md`。設計の境界：`docs/ARCHITECTURE.md`。これから：`docs/ROADMAP.md`
- **表示は pdf.js、書き込みは Rust**。pdf.js の `saveDocument` は使わない（日本語を埋め込まないので Acrobat で文字化けする）。保存に関わる処理は `src-tauri/src/pdf/` に足し、テストを同じファイルに置く
- 注釈の座標はページ自身の PDF 座標（/Rotate の前）。画面との変換は `src/lib/geometry.ts` だけで行う
- 元のファイルを黙って書き換えない。保存は一時ファイルからの入れ替えとバックアップ（`files.rs`）を通す
- テキストボックスの折り返しはフロント（`src/lib/text.ts`）で決めて `Annot.lines` で送る。行の高さと余白の定数は `annots.rs` と同じ値にする
- 操作はコマンド表 `src/lib/commands.ts` にまず足す
- Rust コマンドは `src/lib/api.ts` のラッパ経由で呼ぶ。モック `src/dev/mockBackend.ts` も同じ PR で更新する
- pdf.js は legacy ビルドを使う（`vite.config.ts` の alias）。OS の WebView（古い macOS の Safari）で動かすため

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

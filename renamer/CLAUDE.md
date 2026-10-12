# Renamer

フォルダの中のファイル名をルールに沿って一括で変えるデスクトップアプリ（Tauri 2 / Windows・macOS）

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.1.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。

## このツール固有

- 機能仕様：`docs/SPEC.md`
- 安全策（上書きしないリネーム、2 段階、ジャーナル）：`docs/SAFETY.md`。ファイルを変える処理を触るときは必ず読む
- 設計の境界：`docs/ARCHITECTURE.md`
- 新しい名前の計算と検査は Rust 側だけで行う。フロントで計算しない
- 操作はコマンド表 `src/lib/commands.ts` にまず足す
- Rust コマンドは `src/lib/api.ts` のラッパ経由で呼ぶ。モック `src/dev/mockBackend.ts` も同じ PR で更新する

## コマンド

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザで UI だけ（モック）
npm test               # cargo test + tsc --noEmit
npm run lint
npm run tauri build    # 配布用ビルド（署名鍵が要る。playbook/updater-key.md）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、CSP の緩和、capabilities の追加は人の判断なしに変えない。

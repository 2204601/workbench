# Meter

CPU・メモリ・ディスク・ネットワークの使用状況をタスクトレイ / メニューバーに出し、クリックで詳細のポップアップを開くトレイ常駐アプリ（Tauri 2 / Windows・macOS）

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.2.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。Standard から外れているところは `decisions/` の ADR にある。

## このツール固有

- 構成とファイルごとの役割：`README.md`「構成」。数え方（単位、メモリの使用中、除外するアダプタ）：`README.md`「数え方」。変えたら両方直す
- **見るだけのアプリ**。プロセスを終了する・優先度を変えるなどの操作は、人の判断なしに足さない
- Meter 自身が重くならないこと。アプリごとの使用量（`sampler.rs` の `processes`）はポップアップが開いているあいだだけ読む。トレイのアイコンは値が変わったときだけ描き直す
- Windows のトレイアイコンは 4 つを毎回同じ順で作り、選ばれていないものは隠す（`tray.rs` の冒頭）。作る順を変えない
- トレイアイコンのドット文字（`badge.rs`）を変えたら、16 / 20 / 24 / 32 px で描いて見る。入りきるかはテスト（`every_value_fits_on_the_badge`）が見る
- Rust のコマンドとイベントは `src/api.ts` 経由で使う。モック `src/dev/mockBackend.ts` も同じ PR で更新する
- グラフの色（`src/styles.css` の `--series-1`・`--series-2`）は色覚の検証を通した組み合わせ。入れ替えるときは検証し直す

## コマンド

```bash
npm install
npm run tauri dev      # アプリを起動
npm run dev            # ブラウザでポップアップだけ（モック）
npm test               # cargo test + tsc --noEmit
npm run lint           # eslint + cargo fmt --check + clippy -D warnings
npm run tauri build    # 配布用ビルド（署名鍵が要る。README「開発」）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、CSP の緩和、capabilities の追加は人の判断なしに変えない。

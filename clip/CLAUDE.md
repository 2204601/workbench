# Clip

よく使う文字（メールアドレス、電話番号、署名など）とコピーの履歴を、1 つのショートカットから呼び出して入力するトレイ常駐アプリ（Tauri 2 / macOS・Windows）

## 開発の基準

開発の Standard・Recommendations・Playbook は **`../../desktop-platform/ai/ONBOARDING.md`** を最初に参照すること（採用 tag：v0.3.0）。Web アプリ向けの ai-dev-platform は参照しない。

実装へ大きく影響する前提は `decisions/project-context.md` にある。先に読む。Standard から外れているところは `decisions/` の ADR にある。

モデルは desktop-platform の Governance §3.1 のティアで使い分ける。設計・難しい障害調査・重要なレビューは本体のモデル、通常の実装と文書は Sonnet、テスト実行・スクリーンショット・lint などの確認は Haiku のサブエージェントへ委譲する。委譲した結果は本体が確認してから次へ進む。

## このツール固有

- 構成とファイルごとの役割：`README.md`「構成」
- データ（`src-tauri/src/store.rs`）は JSON 3 ファイル（スニペット、履歴、設定）。形を変えるときは古いファイルを読めるテストを足す
- 履歴には機密が入りうる。記録しないものの判定（`clipboard.rs` の `text_for_history`）を緩めない。履歴をアプリの外へ送る機能は人の判断なしに足さない
- UI は素の TypeScript（`src/popup.ts`、`src/manage.ts`）。React は使っていない
- macOS と Windows で動きが違うもの（クリップボード、元のアプリへの入力、アクセシビリティの許可）は `cfg` で分け、もう一方の OS の扱いを README に書く。Linux では動かさない（開発用の空の実装だけ）

## コマンド

```bash
npm install
npm run tauri dev      # アプリを起動
npm test               # cargo test + tsc --noEmit
npm run lint           # eslint + cargo fmt --check + clippy -D warnings
npm run tauri build    # 配布用ビルド（署名鍵が要る。README「開発」）
```

## 変えないもの

`identifier`、`productName`、updater の `pubkey` と `endpoints`、CSP の緩和、capabilities の追加は人の判断なしに変えない。

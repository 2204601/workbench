# drag 2.1.1（Shelf 用に直した版）

crates.io の [`drag`](https://crates.io/crates/drag) 2.1.1（CrabNebula、Apache-2.0 OR MIT）を、`src-tauri/Cargo.toml` の `[patch.crates-io]` で差し替えている。

直したところは 1 つだけ：`DragMode::Move` のとき、OS へ「移動」だけでなく「コピー」も許すと伝える。

- macOS：`src/lib.rs` の `From<DragMode> for NSDragOperation`（`Move | Copy`）
- Windows：`src/platform_impl/windows/mod.rs` の `DoDragDrop`（`DROPEFFECT_MOVE | DROPEFFECT_COPY`）

元のままだと、移動しか受け付けないドラッグになり、ファイルをコピーとしてしか受け取らないアプリ（Teams、VS Code など）がドロップを断る。

ほかは手を入れていない（`Cargo.toml` の dev-dependencies だけ外した）。tauri-plugin-drag / drag を上げるときは、新しい版にこの変更を当て直すか、上流が複数の操作を渡せるようになっていればこのフォルダを消す。

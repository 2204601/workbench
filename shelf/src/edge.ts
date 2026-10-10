import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// The strip at the screen edge: a drag touching it brings up the shelf, and
// files dropped straight onto it go on the shelf too.
const bar = document.getElementById("bar")!;

void getCurrentWebview().onDragDropEvent(({ payload }) => {
  if (payload.type === "enter") {
    bar.classList.add("active");
    void invoke("edge_drag_enter");
  } else if (payload.type === "leave") {
    bar.classList.remove("active");
  } else if (payload.type === "drop") {
    bar.classList.remove("active");
    if (payload.paths.length) void invoke("add_paths", { paths: payload.paths });
  }
});

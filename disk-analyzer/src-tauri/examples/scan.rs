//! Scans a folder without the window and prints what the app would show at
//! the top: `cargo run --release --example scan -- <folder>`. For timing a
//! large folder or a network share.

use disk_analyzer_lib::scan::{scan, Scan};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

fn main() {
    let root = PathBuf::from(std::env::args().nth(1).expect("usage: scan <folder>"));
    let cancel = AtomicBool::new(false);
    let s = Scan::new(&root, &cancel);
    let started = Instant::now();
    let tree = scan(&root, &s).unwrap_or_else(|e| panic!("{e}"));
    let top = &tree.nodes[0];
    let notes = s.notes();
    println!(
        "{}: {} bytes, {} files, {} folders, {} nodes, {:?}, unreadable {}",
        root.display(),
        top.size,
        top.files,
        top.dirs,
        tree.nodes.len(),
        started.elapsed(),
        notes.unreadable
    );
    for i in top.children().take(10) {
        let n = &tree.nodes[i];
        println!("  {:>14}  {}{}", n.size, n.name, if n.dir { "/" } else { "" });
    }
}

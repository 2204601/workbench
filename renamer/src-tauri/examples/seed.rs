//! Makes a folder of test files for trying the app on many names
//! (Platform Architecture §9: 1 万件で固まらないこと).
//!
//!     cargo run --example seed --manifest-path src-tauri/Cargo.toml -- <folder> [count]
//!
//! Names mix what the rules deal with: numbers, full-width letters,
//! half-width katakana, spaces, upper-case extensions.

use std::fs;
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(dir) = args.next().map(PathBuf::from) else {
        eprintln!("使い方: seed <フォルダ> [件数（既定 10000）]");
        std::process::exit(2);
    };
    let n: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(10_000);
    fs::create_dir_all(&dir).expect("フォルダを作れません");
    const STEMS: [&str; 6] = ["IMG_", "現場写真 ", "ＡＢＣ商事_", "ｶﾀﾛｸﾞ", "Report  ", "見積書（"];
    const EXTS: [&str; 5] = ["JPG", "jpg", "pdf", "xlsx", "txt"];
    for i in 1..=n {
        let stem = STEMS[i % STEMS.len()];
        let ext = EXTS[(i * 7) % EXTS.len()];
        let name = if stem.ends_with('（') { format!("{stem}{i}）.{ext}") } else { format!("{stem}{i:05}.{ext}") };
        fs::write(dir.join(name), i.to_string()).expect("ファイルを作れません");
    }
    println!("{} に {n} 件を作りました", dir.display());
}

//! Runs an export without the window: the job as the page sends it (JSON,
//! src/lib/api.ts `ExportJob`) into an MP4, with the time it took.
//!
//!   cargo run --release --example export -- job.json out.mp4

use std::path::PathBuf;
use std::time::Instant;
use video_studio_lib::ffmpeg::Cancel;
use video_studio_lib::render::{self, ExportJob};

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(job), Some(out)) = (args.next(), args.next()) else {
        eprintln!("usage: export <job.json> <out.mp4>");
        std::process::exit(2);
    };
    let job: ExportJob =
        serde_json::from_slice(&std::fs::read(&job).expect("read job")).expect("job");
    render::validate(&job).expect("valid job");
    let work = std::env::temp_dir().join(format!("video-studio-export-{}", std::process::id()));
    let started = Instant::now();
    let mut shown = -1i64;
    let result = render::export(
        &job,
        &work,
        &PathBuf::from(&out),
        &Cancel::default(),
        |done, total| {
            let pct = (done / total.max(0.001) * 100.0) as i64;
            if pct / 10 != shown / 10 {
                shown = pct;
                eprintln!("{pct}%");
            }
        },
    );
    let _ = std::fs::remove_dir_all(&work);
    match result {
        Ok(()) => println!("{out} in {:?}", started.elapsed()),
        Err(e) => {
            eprintln!("failed: {e}");
            std::process::exit(1);
        }
    }
}

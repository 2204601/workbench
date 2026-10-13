//! Numbers as the tray shows them: the menu-bar title (macOS), the tooltip,
//! and the short values drawn into the tray icons (Windows).
//!
//! Sizes count in 1024s and are written KB / MB / GB, as Explorer and Task
//! Manager do.

use crate::sampler::Sample;
use crate::settings::Metric;

const KB: f64 = 1024.0;
const MB: f64 = KB * 1024.0;
const GB: f64 = MB * 1024.0;

/// "9.8 GB", "512 MB".
pub fn size(bytes: u64) -> String {
    let b = bytes as f64;
    if b >= GB {
        format!("{} GB", one_decimal_under_100(b / GB))
    } else if b >= MB {
        format!("{} MB", (b / MB).round())
    } else {
        format!("{} KB", (b / KB).round())
    }
}

/// "0 KB/s", "850 KB/s", "1.2 MB/s", "35 MB/s".
pub fn rate(bytes_per_sec: u64) -> String {
    let b = bytes_per_sec as f64;
    if b >= GB {
        format!("{} GB/s", one_decimal_under_100(b / GB))
    } else if b >= MB {
        format!("{} MB/s", one_decimal_under_100(b / MB))
    } else {
        format!("{} KB/s", (b / KB).round())
    }
}

/// "1.2" under 10, "35" from there: as many digits as the number deserves.
fn one_decimal_under_100(x: f64) -> String {
    if x < 9.95 {
        format!("{x:.1}")
    } else {
        format!("{x:.0}")
    }
}

/// A speed in at most three characters plus a decimal point, for a 16-pixel
/// icon: "0K", "45K", ".5M", "4.5M", "45M", "1.2G".
pub fn rate_short(bytes_per_sec: u64) -> String {
    let b = bytes_per_sec as f64;
    let k = b / KB;
    if k < 99.5 {
        return format!("{}K", k.round());
    }
    // "100M" would be four characters; from there on it is ".1G".
    let (x, unit) = if b / MB < 99.5 { (b / MB, "M") } else { (b / GB, "G") };
    if x < 0.95 {
        // ".5M" rather than "0.5M": one character fewer.
        format!(".{}{unit}", (x * 10.0).round())
    } else if x < 9.95 {
        format!("{x:.1}{unit}")
    } else {
        // 100 GB/s and up is not a speed a PC reaches.
        format!("{}{unit}", x.round().min(99.0))
    }
}

/// A percentage as a whole number, "0"–"100".
pub fn percent_short(p: f32) -> String {
    format!("{}", p.clamp(0.0, 100.0).round())
}

/// The value one metric shows on its own: the menu-bar title on macOS
/// ("CPU 12%") and the lines of the tooltip.
pub fn label(metric: Metric, s: &Sample) -> String {
    match metric {
        Metric::Cpu => format!("CPU {}%", percent_short(s.cpu)),
        Metric::Memory => format!("メモリ {}%", percent_short(s.mem_percent())),
        Metric::Disk => format!("ディスク {}", rate(s.disk_read + s.disk_write)),
        Metric::Network => format!("↓{} ↑{}", rate(s.net_down), rate(s.net_up)),
        Metric::Unknown => String::new(),
    }
}

/// The macOS menu-bar title: the chosen metrics side by side.
pub fn title(metrics: &[Metric], s: &Sample) -> String {
    metrics.iter().map(|&m| label(m, s)).collect::<Vec<_>>().join("  ")
}

/// The tooltip: the app and version (Optional Standard "トレイ常駐"), then
/// every metric. Kept under Windows' 127 characters.
pub fn tooltip(version: &str, s: &Sample) -> String {
    let text = format!(
        "Meter v{version}\nCPU {}%\nメモリ {}%（{} / {}）\nディスク 読み {} 書き {}\nネット ↓{} ↑{}",
        percent_short(s.cpu),
        percent_short(s.mem_percent()),
        size(s.mem_used),
        size(s.mem_total),
        rate(s.disk_read),
        rate(s.disk_write),
        rate(s.net_down),
        rate(s.net_up),
    );
    text.chars().take(127).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(size(0), "0 KB");
        assert_eq!(size(512 * 1024 * 1024), "512 MB");
        assert_eq!(size(16 * 1024 * 1024 * 1024), "16 GB");
        assert_eq!(size(10_522_669_875), "9.8 GB");
    }

    #[test]
    fn rates() {
        assert_eq!(rate(0), "0 KB/s");
        assert_eq!(rate(850 * 1024), "850 KB/s");
        assert_eq!(rate(1_258_291), "1.2 MB/s");
        assert_eq!(rate(35 * 1024 * 1024), "35 MB/s");
        assert_eq!(rate(2 * 1024 * 1024 * 1024), "2.0 GB/s");
    }

    #[test]
    fn short_rates_fit_in_an_icon() {
        let cases = [
            (0, "0K"),
            (400, "0K"),
            (45 * 1024, "45K"),
            (99 * 1024, "99K"),
            (500 * 1024, ".5M"),
            (4_718_592, "4.5M"),
            (45 * 1024 * 1024, "45M"),
            (450 * 1024 * 1024, ".4G"),
            (999 * 1024 * 1024, "1.0G"),
            (1_288_490_189, "1.2G"),
            (50 * 1024 * 1024 * 1024, "50G"),
        ];
        for (bytes, text) in cases {
            assert_eq!(rate_short(bytes), text, "{bytes}");
        }
        // Every value, not just these: no more than three characters besides the point.
        let mut b = 1u64;
        while b < 1 << 50 {
            let s = rate_short(b);
            assert!(s.chars().filter(|c| *c != '.').count() <= 3, "{b} -> {s}");
            b = b * 3 / 2 + 1;
        }
    }

    #[test]
    fn percentages() {
        assert_eq!(percent_short(0.4), "0");
        assert_eq!(percent_short(41.6), "42");
        assert_eq!(percent_short(100.0), "100");
        assert_eq!(percent_short(130.0), "100");
    }

    #[test]
    fn title_and_tooltip() {
        let s = Sample {
            cpu: 12.3,
            mem_used: 8 * 1024 * 1024 * 1024,
            mem_total: 16 * 1024 * 1024 * 1024,
            net_down: 1_258_291,
            net_up: 30 * 1024,
            ..Sample::default()
        };
        assert_eq!(title(&[Metric::Cpu, Metric::Memory], &s), "CPU 12%  メモリ 50%");
        assert_eq!(title(&[Metric::Network], &s), "↓1.2 MB/s ↑30 KB/s");

        let busy = Sample {
            disk_read: 999 * 1024 * 1024,
            disk_write: 999 * 1024 * 1024,
            net_down: 999 * 1024 * 1024,
            net_up: 999 * 1024 * 1024,
            ..s
        };
        let tip = tooltip("10.10.10", &busy);
        assert!(tip.starts_with("Meter v10.10.10\nCPU 12%\nメモリ 50%（8.0 GB / 16 GB）"), "{tip}");
        assert!(tip.chars().count() <= 127);
    }
}

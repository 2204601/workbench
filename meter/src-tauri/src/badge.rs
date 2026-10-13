//! The tray icons on Windows: one small square per metric, with a short name
//! on top ("CPU") and the value under it ("42"), on a colour that turns from
//! green to amber to red as the value rises.
//!
//! The Windows tray can't show text beside an icon, so the numbers are drawn
//! into the icon itself. The letters are a pixel font designed on a 16 × 16
//! grid, the size of a tray icon at 100 % scaling, and drawn at the size the
//! tray actually uses (20 px at 125 %, 32 px at 200 %), each grid cell
//! snapped to whole pixels.

use crate::format::{percent_short, rate_short};
use crate::sampler::Sample;
use crate::settings::Metric;

/// The grid the badge is designed on.
const GRID: f32 = 16.0;

#[derive(Clone, PartialEq, Debug)]
pub struct Badge {
    pub label: &'static str,
    pub value: String,
    pub color: [u8; 3],
}

const GREEN: [u8; 3] = [0x15, 0x80, 0x3d];
const AMBER: [u8; 3] = [0xb4, 0x53, 0x09];
const RED: [u8; 3] = [0xb9, 0x1c, 0x1c];
/// Speeds have no "too much", so they keep one colour each.
const TEAL: [u8; 3] = [0x0e, 0x74, 0x90];
const INDIGO: [u8; 3] = [0x43, 0x38, 0xca];

/// Where a percentage turns amber and red. Memory sits higher than the CPU
/// in everyday use, so it warns later.
fn level_color(metric: Metric, percent: f32) -> [u8; 3] {
    let (warn, high) = if metric == Metric::Memory { (75.0, 90.0) } else { (60.0, 85.0) };
    if percent >= high {
        RED
    } else if percent >= warn {
        AMBER
    } else {
        GREEN
    }
}

pub fn for_metric(metric: Metric, s: &Sample) -> Badge {
    match metric {
        Metric::Cpu => Badge { label: "CPU", value: percent_short(s.cpu), color: level_color(metric, s.cpu) },
        Metric::Memory => {
            let p = s.mem_percent();
            Badge { label: "MEM", value: percent_short(p), color: level_color(metric, p) }
        }
        Metric::Disk => Badge { label: "DSK", value: rate_short(s.disk_read + s.disk_write), color: TEAL },
        Metric::Network => Badge { label: "NET", value: rate_short(s.net_down + s.net_up), color: INDIGO },
        Metric::Unknown => Badge { label: "", value: String::new(), color: GREEN },
    }
}

// ---------------------------------------------------------------------------
// Fonts. Each glyph is rows of '#' (ink) and '.' (none); widths vary.

type Font = &'static [(char, &'static [&'static str])];

/// 5 rows, for the name on top.
const LABEL: Font = &[
    ('C', &[".##", "#..", "#..", "#..", ".##"]),
    ('P', &["##.", "#.#", "##.", "#..", "#.."]),
    ('U', &["#.#", "#.#", "#.#", "#.#", "###"]),
    ('M', &["#...#", "##.##", "#.#.#", "#...#", "#...#"]),
    ('E', &["###", "#..", "##.", "#..", "###"]),
    ('D', &["##.", "#.#", "#.#", "#.#", "##."]),
    ('S', &[".##", "#..", ".#.", "..#", "##."]),
    ('K', &["#.#", "#.#", "##.", "#.#", "#.#"]),
    ('N', &["#..#", "##.#", "#.##", "#..#", "#..#"]),
    ('T', &["###", ".#.", ".#.", ".#.", ".#."]),
];

/// 9 rows with two-pixel strokes, for percentages of one or two digits.
const BIG: Font = &[
    ('0', &[".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."]),
    ('1', &["..##..", ".###..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", ".####."]),
    ('2', &[".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "######"]),
    ('3', &[".####.", "##..##", "....##", "....##", "..###.", "....##", "....##", "##..##", ".####."]),
    ('4', &["...##.", "..###.", ".####.", "##.##.", "##.##.", "######", "...##.", "...##.", "...##."]),
    ('5', &["######", "##....", "##....", "#####.", "....##", "....##", "....##", "##..##", ".####."]),
    ('6', &[".####.", "##..##", "##....", "##....", "#####.", "##..##", "##..##", "##..##", ".####."]),
    ('7', &["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##.."]),
    ('8', &[".####.", "##..##", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", ".####."]),
    ('9', &[".####.", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "##..##", ".####."]),
];

/// 7 rows, narrow, for "100" and speeds ("4.5M").
const SMALL: Font = &[
    ('0', &["###", "#.#", "#.#", "#.#", "#.#", "#.#", "###"]),
    ('1', &[".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"]),
    ('2', &["###", "..#", "..#", "###", "#..", "#..", "###"]),
    ('3', &["###", "..#", "..#", "###", "..#", "..#", "###"]),
    ('4', &["#.#", "#.#", "#.#", "###", "..#", "..#", "..#"]),
    ('5', &["###", "#..", "#..", "###", "..#", "..#", "###"]),
    ('6', &["###", "#..", "#..", "###", "#.#", "#.#", "###"]),
    ('7', &["###", "..#", "..#", ".#.", ".#.", ".#.", ".#."]),
    ('8', &["###", "#.#", "#.#", "###", "#.#", "#.#", "###"]),
    ('9', &["###", "#.#", "#.#", "###", "..#", "..#", "###"]),
    ('.', &[".", ".", ".", ".", ".", ".", "#"]),
    ('K', &["#..#", "#..#", "#.#.", "##..", "#.#.", "#..#", "#..#"]),
    ('M', &["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"]),
    ('G', &[".###", "#...", "#...", "#.##", "#..#", "#..#", ".###"]),
];

fn glyph(font: Font, c: char) -> Option<&'static [&'static str]> {
    font.iter().find(|(g, _)| *g == c).map(|(_, rows)| *rows)
}

/// Width on the grid, with one empty column between glyphs. None if a
/// character isn't in the font.
fn text_width(font: Font, text: &str) -> Option<usize> {
    let widths: Option<Vec<usize>> = text.chars().map(|c| glyph(font, c).map(|rows| rows[0].len())).collect();
    let widths = widths?;
    Some(widths.iter().sum::<usize>() + widths.len().saturating_sub(1))
}

/// The font for a value: the big one when it fits, otherwise the narrow one.
fn value_font(value: &str) -> Font {
    match text_width(BIG, value) {
        Some(w) if w <= 14 => BIG,
        _ => SMALL,
    }
}

/// Grid cells (x, y) inked by `text`, starting at `top` and centred.
fn ink(font: Font, text: &str, top: usize) -> Vec<(usize, usize)> {
    let Some(width) = text_width(font, text) else {
        return Vec::new();
    };
    let mut x = (GRID as usize).saturating_sub(width) / 2;
    let mut cells = Vec::new();
    for c in text.chars() {
        let rows = glyph(font, c).unwrap_or_default();
        for (dy, row) in rows.iter().enumerate() {
            for (dx, px) in row.bytes().enumerate() {
                if px == b'#' {
                    cells.push((x + dx, top + dy));
                }
            }
        }
        x += rows.first().map_or(0, |r| r.len()) + 1;
    }
    cells
}

/// Everything on the grid that is drawn in the text colour, and how opaque.
fn layout(badge: &Badge) -> Vec<(usize, usize, f32)> {
    let mut cells: Vec<(usize, usize, f32)> =
        ink(LABEL, badge.label, 1).into_iter().map(|(x, y)| (x, y, 0.8)).collect();
    let font = value_font(&badge.value);
    // The value fills rows 7–15; the narrow font is two rows shorter.
    let top = if font == BIG { 7 } else { 8 };
    cells.extend(ink(font, &badge.value, top).into_iter().map(|(x, y)| (x, y, 1.0)));
    cells
}

/// The badge as straight (not premultiplied) RGBA, `size` × `size` pixels.
pub fn render(badge: &Badge, size: u32) -> Vec<u8> {
    let size = size.max(1);
    let n = size as usize;
    let scale = size as f32 / GRID;

    // Each grid cell becomes the pixels between its edges rounded to whole
    // pixels: at 125 % and 150 % some strokes are a pixel wider than others,
    // but none are smeared over two half-lit pixels, which small text can't
    // afford.
    let edge = |g: usize| ((g as f32 * scale).round() as usize).min(n);
    let mut text = vec![0f32; n * n];
    for (gx, gy, alpha) in layout(badge) {
        for py in edge(gy)..edge(gy + 1) {
            for px in edge(gx)..edge(gx + 1) {
                text[py * n + px] = alpha;
            }
        }
    }

    let radius = 2.5 * scale;
    let mut rgba = Vec::with_capacity(n * n * 4);
    for py in 0..n {
        for px in 0..n {
            let bg = rounded_square_coverage(px, py, size as f32, radius);
            let t = text[py * n + px];
            let mix = |c: u8| (c as f32 * (1.0 - t) + 255.0 * t).round() as u8;
            rgba.extend_from_slice(&[mix(badge.color[0]), mix(badge.color[1]), mix(badge.color[2])]);
            rgba.push((bg * 255.0).round() as u8);
        }
    }
    rgba
}

/// How much of pixel (px, py) a square of `size` with rounded corners covers,
/// sampled 4 × 4.
fn rounded_square_coverage(px: usize, py: usize, size: f32, radius: f32) -> f32 {
    let mut inside = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            let x = px as f32 + (sx as f32 + 0.5) / 4.0;
            let y = py as f32 + (sy as f32 + 0.5) / 4.0;
            // Distance into the corner region, if in one.
            let cx = x.clamp(radius, size - radius);
            let cy = y.clamp(radius, size - radius);
            let (dx, dy) = (x - cx, y - cy);
            if dx * dx + dy * dy <= radius * radius {
                inside += 1;
            }
        }
    }
    inside as f32 / 16.0
}

/// The tray icon size Windows uses at the current display scaling: 16 px at
/// 100 %, 20 at 125 %, 24 at 150 %, 32 at 200 %.
pub fn tray_size() -> u32 {
    #[cfg(windows)]
    {
        use windows::Win32::UI::{
            HiDpi::{GetDpiForSystem, GetSystemMetricsForDpi},
            WindowsAndMessaging::SM_CXSMICON,
        };
        let size = unsafe { GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForSystem()) };
        if size > 0 {
            return (size as u32).clamp(16, 64);
        }
    }
    32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * size + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn every_glyph_is_a_rectangle() {
        for (font, rows) in [(LABEL, 5), (BIG, 9), (SMALL, 7)] {
            for (c, glyph) in font {
                assert_eq!(glyph.len(), rows, "{c}");
                assert!(glyph.iter().all(|r| r.len() == glyph[0].len()), "{c}");
                assert!(glyph.iter().all(|r| r.bytes().all(|b| b == b'#' || b == b'.')), "{c}");
            }
        }
    }

    #[test]
    fn every_value_fits_on_the_badge() {
        let mut values: Vec<String> = (0..=100).map(|p| percent_short(p as f32)).collect();
        let mut b = 0u64;
        while b < 1 << 46 {
            values.push(rate_short(b));
            b = b * 5 / 4 + 1;
        }
        for value in values {
            let font = value_font(&value);
            let width = text_width(font, &value).unwrap_or_else(|| panic!("{value} has a missing glyph"));
            assert!(width <= 15, "{value} is {width} wide");
        }
        for label in ["CPU", "MEM", "DSK", "NET"] {
            assert!(text_width(LABEL, label).is_some_and(|w| w <= 15), "{label}");
        }
    }

    #[test]
    fn two_digits_are_big_and_three_are_narrow() {
        assert!(value_font("7") == BIG);
        assert!(value_font("42") == BIG);
        assert!(value_font("100") == SMALL);
        assert!(value_font("4.5M") == SMALL);
    }

    #[test]
    fn colours_follow_the_level() {
        let at = |cpu: f32| for_metric(Metric::Cpu, &Sample { cpu, ..Sample::default() }).color;
        assert_eq!(at(10.0), GREEN);
        assert_eq!(at(60.0), AMBER);
        assert_eq!(at(90.0), RED);
        let mem = |used: u64| {
            for_metric(Metric::Memory, &Sample { mem_used: used, mem_total: 100, ..Sample::default() }).color
        };
        assert_eq!(mem(70), GREEN);
        assert_eq!(mem(80), AMBER);
        assert_eq!(mem(95), RED);
    }

    #[test]
    fn rendered_at_any_tray_size() {
        let badge = Badge { label: "CPU", value: "42".into(), color: GREEN };
        for size in [16, 20, 24, 32] {
            let rgba = render(&badge, size);
            assert_eq!(rgba.len(), (size * size * 4) as usize);
            // Rounded corners are (nearly) see-through, the middle of an edge is not.
            assert!(pixel(&rgba, size, 0, 0)[3] < 64, "{size}");
            assert_eq!(pixel(&rgba, size, 0, size / 2)[3], 255, "{size}");
        }
    }

    #[test]
    fn text_is_drawn_in_white_at_16_px() {
        let badge = Badge { label: "CPU", value: "88".into(), color: RED };
        let rgba = render(&badge, 16);
        // The value's first glyph starts at x = 1 (13 wide, centred); row 7
        // is the top of the "8": ".####." puts ink at x = 2.
        assert_eq!(pixel(&rgba, 16, 2, 7), [255, 255, 255, 255]);
        assert_eq!(pixel(&rgba, 16, 1, 7), [RED[0], RED[1], RED[2], 255]);
        // The label is a little dimmer than the value.
        let c = pixel(&rgba, 16, 3, 1);
        assert!(c[0] > 200 && c[0] < 255, "{c:?}");
    }

    #[test]
    fn whole_multiples_stay_sharp() {
        let badge = Badge { label: "MEM", value: "61".into(), color: GREEN };
        let small = render(&badge, 16);
        let large = render(&badge, 32);
        for y in 2..14 {
            for x in 2..14 {
                let p = pixel(&small, 16, x, y);
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    assert_eq!(pixel(&large, 32, x * 2 + dx, y * 2 + dy), p, "({x}, {y})");
                }
            }
        }
    }
}

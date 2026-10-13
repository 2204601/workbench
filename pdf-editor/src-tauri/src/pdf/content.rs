//! A small writer for content streams (appearance streams of annotations
//! and form fields): numbers are written short, operators one per line.

use std::fmt::Write;

#[derive(Default)]
pub struct Content(String);

/// 3 decimals: a thousandth of a point is far below anything visible.
pub fn num(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    let s = format!("{:.3}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    match s {
        "-0" | "" => "0".into(),
        _ => s.into(),
    }
}

impl Content {
    pub fn new() -> Self {
        Self::default()
    }

    /// Operands then the operator, as one line.
    pub fn op(&mut self, operands: &[f64], operator: &str) -> &mut Self {
        for v in operands {
            self.0.push_str(&num(*v));
            self.0.push(' ');
        }
        self.0.push_str(operator);
        self.0.push('\n');
        self
    }

    /// A line as it is (names, strings).
    pub fn raw(&mut self, line: &str) -> &mut Self {
        self.0.push_str(line);
        self.0.push('\n');
        self
    }

    pub fn save(&mut self) -> &mut Self {
        self.raw("q")
    }

    pub fn restore(&mut self) -> &mut Self {
        self.raw("Q")
    }

    pub fn stroke_rgb(&mut self, c: [f64; 3]) -> &mut Self {
        self.op(&c, "RG")
    }

    pub fn fill_rgb(&mut self, c: [f64; 3]) -> &mut Self {
        self.op(&c, "rg")
    }

    pub fn gs(&mut self, name: &str) -> &mut Self {
        self.raw(&format!("/{name} gs"))
    }

    pub fn rect(&mut self, x: f64, y: f64, w: f64, h: f64) -> &mut Self {
        self.op(&[x, y, w, h], "re")
    }

    pub fn move_to(&mut self, x: f64, y: f64) -> &mut Self {
        self.op(&[x, y], "m")
    }

    pub fn line_to(&mut self, x: f64, y: f64) -> &mut Self {
        self.op(&[x, y], "l")
    }

    pub fn curve_to(&mut self, p: [f64; 6]) -> &mut Self {
        self.op(&p, "c")
    }

    /// An ellipse inside [x1, y1, x2, y2], from four Bézier arcs.
    pub fn ellipse(&mut self, r: [f64; 4]) -> &mut Self {
        const K: f64 = 0.552_284_75;
        let (cx, cy) = ((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0);
        let (rx, ry) = ((r[2] - r[0]) / 2.0, (r[3] - r[1]) / 2.0);
        let (kx, ky) = (rx * K, ry * K);
        self.move_to(cx + rx, cy);
        self.curve_to([cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry]);
        self.curve_to([cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy]);
        self.curve_to([cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry]);
        self.curve_to([cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy]);
        self.raw("h")
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.0.into_bytes()
    }
}

impl Write for Content {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.0.push_str(s);
        Ok(())
    }
}

/// A literal string for a content stream, with the specials escaped.
pub fn literal(bytes: &[u8]) -> String {
    let mut s = String::from("(");
    for &b in bytes {
        match b {
            b'(' | b')' | b'\\' => {
                s.push('\\');
                s.push(b as char);
            }
            0x20..=0x7e => s.push(b as char),
            _ => {
                let _ = write!(s, "\\{:03o}", b);
            }
        }
    }
    s.push(')');
    s
}

pub fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2 + 2);
    s.push('<');
    for b in bytes {
        let _ = write!(s, "{:02X}", b);
    }
    s.push('>');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_short() {
        assert_eq!(num(1.0), "1");
        assert_eq!(num(0.5), "0.5");
        assert_eq!(num(-0.0001), "0");
        assert_eq!(num(12.34567), "12.346");
        assert_eq!(num(f64::NAN), "0");
    }

    #[test]
    fn strings() {
        assert_eq!(literal(b"a(b)\\"), "(a\\(b\\)\\\\)");
        assert_eq!(literal(&[0xe9]), "(\\351)");
        assert_eq!(hex(&[0, 0xab]), "<00AB>");
    }
}

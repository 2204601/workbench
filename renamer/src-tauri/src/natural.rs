//! Name order as people expect it (docs/SPEC.md §5.3): "2" before "10",
//! upper and lower case together. Numbering follows this order.

use std::cmp::Ordering;

/// Compares runs of digits by their value and everything else by lower-cased text.
pub fn cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let n = take_digits(&mut x);
                let m = take_digits(&mut y);
                // Leading zeros aside, the longer run is the bigger number.
                let (nt, mt) = (n.trim_start_matches('0'), m.trim_start_matches('0'));
                let ord = nt.len().cmp(&mt.len()).then_with(|| nt.cmp(mt)).then_with(|| n.len().cmp(&m.len()));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(c), Some(d)) => {
                let ord = c.to_lowercase().cmp(d.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                x.next();
                y.next();
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
        s.push(c);
        it.next();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(mut v: Vec<&str>) -> Vec<&str> {
        v.sort_by(|a, b| cmp(a, b));
        v
    }

    #[test]
    fn numbers_by_value() {
        assert_eq!(sorted(vec!["img10.jpg", "img2.jpg", "img1.jpg"]), ["img1.jpg", "img2.jpg", "img10.jpg"]);
        assert_eq!(sorted(vec!["a010", "a9", "a10"]), ["a9", "a10", "a010"]);
        assert_eq!(sorted(vec!["写真 12", "写真 3"]), ["写真 3", "写真 12"]);
    }

    #[test]
    fn case_together() {
        assert_eq!(sorted(vec!["b", "A", "a", "B"]), ["A", "a", "B", "b"]);
    }

    #[test]
    fn long_numbers_dont_overflow() {
        assert_eq!(cmp("x99999999999999999999999", "x100000000000000000000000"), Ordering::Less);
    }
}

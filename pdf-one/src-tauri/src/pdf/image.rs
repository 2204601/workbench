//! Pictures put on pages (seals, signatures, logos): PNG or JPEG files, kept
//! in a store while the app runs and written as image XObjects.

use lopdf::{dictionary, Document, ObjectId, Stream};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

/// A picture as the user gave it (PNG or JPEG), which is also what the
/// frontend shows.
pub struct StoredImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

/// Larger pictures are scaled down: a seal or a signature doesn't need more,
/// and a photo straight from a phone would make the file tens of MB.
const MAX_SIDE: u32 = 2400;
/// Files over this aren't read at all (Platform Security §4).
pub const MAX_FILE: usize = 40 * 1024 * 1024;

fn limits() -> image::Limits {
    let mut l = image::Limits::default();
    l.max_image_width = Some(20_000);
    l.max_image_height = Some(20_000);
    l.max_alloc = Some(512 * 1024 * 1024);
    l
}

fn sniff(bytes: &[u8]) -> Option<(image::ImageFormat, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some((image::ImageFormat::Png, "image/png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some((image::ImageFormat::Jpeg, "image/jpeg"))
    } else {
        None
    }
}

fn reader(bytes: &[u8], format: image::ImageFormat) -> image::ImageReader<Cursor<&[u8]>> {
    let mut r = image::ImageReader::with_format(Cursor::new(bytes), format);
    r.limits(limits());
    r
}

/// Checks a picture by its content (not its name) and reads its size.
pub fn read_image(bytes: Vec<u8>) -> Result<StoredImage, String> {
    if bytes.len() > MAX_FILE {
        return Err("画像が大きすぎます（40 MB まで）".into());
    }
    let (format, mime) = sniff(&bytes).ok_or("PNG か JPEG の画像を選んでください")?;
    let (width, height) =
        reader(&bytes, format).into_dimensions().map_err(|e| format!("画像を読み込めませんでした: {e}"))?;
    Ok(StoredImage { bytes, mime, width, height })
}

/// The pictures of this run, by id. Ids are unique across stores, so a
/// store filled on the side (while opening a file) can be merged in.
#[derive(Default, Clone)]
pub struct ImageStore {
    map: HashMap<u32, Arc<StoredImage>>,
}

impl ImageStore {
    pub fn add(&mut self, img: StoredImage) -> u32 {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
        let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.map.insert(id, Arc::new(img));
        id
    }

    pub fn merge(&mut self, other: ImageStore) {
        self.map.extend(other.map);
    }

    pub fn get(&self, id: u32) -> Option<Arc<StoredImage>> {
        self.map.get(&id).cloned()
    }
}

/// Writes `img` as an image XObject (with a soft mask for transparency).
pub fn image_xobject(doc: &mut Document, img: &StoredImage) -> Result<ObjectId, String> {
    let (format, _) = sniff(&img.bytes).ok_or("画像の形式が分かりません")?;
    let fits = img.width.max(img.height) <= MAX_SIDE;
    if format == image::ImageFormat::Jpeg && fits {
        // A JPEG goes in as it is (DCTDecode), unless it is CMYK or such,
        // which needs care with its colors: those are decoded below.
        let decoder = reader(&img.bytes, format).into_decoder().map_err(|e| e.to_string())?;
        use image::ImageDecoder;
        let space = match decoder.color_type() {
            image::ColorType::L8 => Some("DeviceGray"),
            image::ColorType::Rgb8 => Some("DeviceRGB"),
            _ => None,
        };
        if let Some(space) = space {
            let stream = Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => img.width as i64,
                    "Height" => img.height as i64,
                    "ColorSpace" => space,
                    "BitsPerComponent" => 8,
                    "Filter" => "DCTDecode",
                },
                img.bytes.clone(),
            );
            return Ok(doc.add_object(stream));
        }
    }
    let mut decoded = reader(&img.bytes, format).decode().map_err(|e| format!("画像を読み込めませんでした: {e}"))?;
    if !fits {
        decoded = decoded.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Triangle);
    }
    let rgba = decoded.to_rgba8();
    let (w, h) = rgba.dimensions();
    let opaque = rgba.pixels().all(|p| p.0[3] == 255);
    let rgb: Vec<u8> = rgba.pixels().flat_map(|p| [p.0[0], p.0[1], p.0[2]]).collect();
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => w as i64,
        "Height" => h as i64,
        "ColorSpace" => "DeviceRGB",
        "BitsPerComponent" => 8,
    };
    if !opaque {
        let alpha: Vec<u8> = rgba.pixels().map(|p| p.0[3]).collect();
        let mut mask = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w as i64,
                "Height" => h as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            alpha,
        );
        let _ = mask.compress();
        dict.set("SMask", doc.add_object(mask));
    }
    let mut stream = Stream::new(dict, rgb);
    let _ = stream.compress();
    Ok(doc.add_object(stream))
}

/// Reads back a picture this app wrote (`image_xobject`): a JPEG as it is,
/// or 8-bit RGB / gray (with its soft mask) as a PNG.
pub fn from_xobject(doc: &Document, id: ObjectId) -> Option<StoredImage> {
    let s = doc.get_object(id).ok()?.as_stream().ok()?;
    let d = &s.dict;
    let w = super::number(d.get(b"Width").ok()?)? as u32;
    let h = super::number(d.get(b"Height").ok()?)? as u32;
    if w == 0 || h == 0 || w > 20_000 || h > 20_000 {
        return None;
    }
    if super::get_name(d, b"Filter") == Some(b"DCTDecode") {
        return read_image(s.content.clone()).ok();
    }
    let data = s.decompressed_content().ok().unwrap_or_else(|| s.content.clone());
    let n = (w * h) as usize;
    let rgb: Vec<[u8; 3]> = match super::get_name(d, b"ColorSpace")? {
        b"DeviceRGB" if data.len() >= n * 3 => data.as_chunks::<3>().0[..n].to_vec(),
        b"DeviceGray" if data.len() >= n => data.iter().take(n).map(|&g| [g, g, g]).collect(),
        _ => return None,
    };
    let alpha: Option<Vec<u8>> = d.get(b"SMask").ok().and_then(super::ref_id).and_then(|m| {
        let m = doc.get_object(m).ok()?.as_stream().ok()?;
        let a = m.decompressed_content().ok().unwrap_or_else(|| m.content.clone());
        (a.len() >= n).then_some(a)
    });
    let mut out = image::RgbaImage::new(w, h);
    for (i, px) in out.pixels_mut().enumerate() {
        let [r, g, b] = rgb[i];
        px.0 = [r, g, b, alpha.as_ref().map(|a| a[i]).unwrap_or(255)];
    }
    let mut png = Vec::new();
    out.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(StoredImage { bytes: png, mime: "image/png", width: w, height: h })
}

/// A red seal-like picture for tests: a ring with a transparent outside.
#[cfg(test)]
pub(crate) fn test_png() -> Vec<u8> {
    let img = image::RgbaImage::from_fn(40, 40, |x, y| {
        let d = ((x as f64 - 19.5).powi(2) + (y as f64 - 19.5).powi(2)).sqrt();
        if (14.0..19.0).contains(&d) {
            image::Rgba([220, 30, 30, 255])
        } else {
            image::Rgba([0, 0, 0, 0])
        }
    });
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
    png
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_round_trips_with_its_transparency() {
        let img = read_image(test_png()).unwrap();
        assert_eq!((img.width, img.height, img.mime), (40, 40, "image/png"));
        let mut doc = Document::with_version("1.7");
        let id = image_xobject(&mut doc, &img).unwrap();
        let dict = &doc.get_object(id).unwrap().as_stream().unwrap().dict;
        assert!(dict.get(b"SMask").is_ok());
        let back = from_xobject(&doc, id).unwrap();
        assert_eq!((back.width, back.height), (40, 40));
        let px = image::load_from_memory(&back.bytes).unwrap().to_rgba8();
        assert_eq!(px.get_pixel(0, 0).0[3], 0);
        assert_eq!(px.get_pixel(20, 3).0, [220, 30, 30, 255]);
    }

    #[test]
    fn jpeg_goes_in_as_it_is() {
        let mut jpg = Vec::new();
        image::RgbImage::from_pixel(8, 8, image::Rgb([10, 200, 10]))
            .write_to(&mut Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
            .unwrap();
        let img = read_image(jpg.clone()).unwrap();
        let mut doc = Document::with_version("1.7");
        let id = image_xobject(&mut doc, &img).unwrap();
        let s = doc.get_object(id).unwrap().as_stream().unwrap();
        assert_eq!(s.content, jpg);
        assert_eq!(from_xobject(&doc, id).unwrap().mime, "image/jpeg");
    }

    #[test]
    fn other_files_are_refused() {
        assert!(read_image(b"GIF89a....".to_vec()).is_err());
        assert!(read_image(b"%PDF-1.7".to_vec()).is_err());
    }
}

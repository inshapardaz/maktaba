//! PDF metadata + cover extraction. Mirrors Maktaba.Metadata/PdfMetadataExtractor.cs, which used
//! PdfPig for the info dictionary and PDFtoImage (a pdfium wrapper) to rasterize page 1 as the
//! cover. Here lopdf reads the info dictionary and pdfium-render (bound to a bundled pdfium
//! shared library, see backend-rust/README) renders the cover - same underlying renderer
//! (pdfium) as the C# version used, just via a different binding.

use std::path::Path;

use chrono::NaiveDate;
use pdfium_render::prelude::*;
use std::sync::LazyLock;

use maktaba_core::metadata::{BookMetadataExtractor, ExtractedBookMetadata};

pub struct PdfMetadataExtractor;

impl BookMetadataExtractor for PdfMetadataExtractor {
    fn can_handle(&self, file_path: &Path) -> bool {
        file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
    }

    fn extract(&self, file_path: &Path) -> anyhow::Result<ExtractedBookMetadata> {
        let doc = lopdf::Document::load(file_path)?;

        let info = doc
            .trailer
            .get(b"Info")
            .ok()
            .and_then(|obj| doc.get_object(obj.as_reference().ok()?).ok())
            .and_then(|obj| obj.as_dict().ok().cloned());

        let raw_title = info.as_ref().and_then(|d| pdf_string(d, b"Title"));
        let raw_author = info.as_ref().and_then(|d| pdf_string(d, b"Author"));
        let raw_subject = info.as_ref().and_then(|d| pdf_string(d, b"Subject"));
        let raw_creation_date = info.as_ref().and_then(|d| pdf_string(d, b"CreationDate"));

        let title = match raw_title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
            Some(t) => t,
            None => file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string(),
        };

        let (cover_bytes, cover_content_type) = try_render_first_page_cover(file_path);

        Ok(ExtractedBookMetadata {
            title,
            authors: split_authors(raw_author.as_deref()),
            // The standard PDF info dictionary has no publisher/language fields, unlike EPUB's OPF.
            language: None,
            publisher: None,
            published_date: raw_creation_date.as_deref().and_then(try_parse_pdf_date),
            description: raw_subject.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            identifiers: vec![],
            cover_image_bytes: cover_bytes,
            cover_content_type,
        })
    }
}

/// Decodes a PDF string value: UTF-16BE (with a `\xFE\xFF` BOM) for Unicode text strings, or
/// PDFDocEncoding otherwise - approximated here as Latin-1, which matches for the ASCII range
/// that covers the vast majority of real-world PDF metadata.
fn pdf_string(dict: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    let bytes = dict.get(key).ok()?.as_str().ok()?;

    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let utf16: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return Some(String::from_utf16_lossy(&utf16));
    }

    Some(bytes.iter().map(|&b| b as char).collect())
}

fn split_authors(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else { return vec![] };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    static SEPARATOR: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r";| and |&").unwrap());
    let re = &*SEPARATOR;

    let parts: Vec<String> = re
        .split(trimmed)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if parts.is_empty() {
        vec![trimmed.to_string()]
    } else {
        parts
    }
}

/// PDF date format: "D:YYYYMMDDHHmmSS[+-]HH'mm'" (ISO 32000-1 §7.9.4).
fn try_parse_pdf_date(raw: &str) -> Option<NaiveDate> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    let value = raw.strip_prefix("D:").unwrap_or(raw);
    if value.len() >= 8 {
        let year = value[0..4].parse::<i32>().ok();
        let month = value[4..6].parse::<u32>().ok();
        let day = value[6..8].parse::<u32>().ok();
        if let (Some(y), Some(m), Some(d)) = (year, month, day) {
            if let Some(date) = NaiveDate::from_ymd_opt(y, m, d) {
                return Some(date);
            }
        }
    }

    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.date_naive())
        .ok()
}

fn try_render_first_page_cover(file_path: &Path) -> (Option<Vec<u8>>, Option<String>) {
    match render_first_page_cover(file_path) {
        Ok(bytes) => (Some(bytes), Some("image/jpeg".to_string())),
        Err(err) => {
            // Encrypted/malformed/zero-page PDFs, or a missing pdfium library, can fail to
            // rasterize; import proceeds without a cover, matching the C# extractor's behavior.
            tracing::debug!("PDF cover render skipped for {:?}: {err:#}", file_path);
            (None, None)
        }
    }
}

/// `Pdfium` (a `Box<dyn PdfiumLibraryBindings>` under the hood) isn't `Send`/`Sync`, and its
/// underlying library (which bundles its own V8 instance for form/JS support) aborts the whole
/// process with a fatal "V8StartupState" error if bound and torn down more than once - re-binding
/// fresh on every cover render (the original, per-call approach) crashed after the second PDF
/// import. So instead: one dedicated OS thread owns the single `Pdfium` instance for the entire
/// process lifetime (bound once, on first use, never torn down until the process exits), and
/// every render request - however many concurrent `spawn_blocking` tasks are calling in - is
/// serialized through a channel to that one thread.
struct RenderRequest {
    file_path: std::path::PathBuf,
    respond_to: std::sync::mpsc::Sender<anyhow::Result<Vec<u8>>>,
}

static RENDER_THREAD: LazyLock<std::sync::mpsc::Sender<RenderRequest>> = LazyLock::new(|| {
    let (tx, rx) = std::sync::mpsc::channel::<RenderRequest>();

    std::thread::spawn(move || {
        let pdfium = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&pdfium_library_dir()))
            .or_else(|_| Pdfium::bind_to_system_library())
            .map(Pdfium::new)
            .ok();

        for request in rx {
            let result = match &pdfium {
                Some(pdfium) => render_with_pdfium(pdfium, &request.file_path),
                None => Err(anyhow::anyhow!("pdfium shared library is not available")),
            };
            // Ignored: the caller may have already given up (e.g. request cancelled), in which
            // case there's nothing left to deliver the result to.
            let _ = request.respond_to.send(result);
        }
    });

    tx
});

fn render_first_page_cover(file_path: &Path) -> anyhow::Result<Vec<u8>> {
    let (respond_to, response) = std::sync::mpsc::channel();
    RENDER_THREAD
        .send(RenderRequest { file_path: file_path.to_path_buf(), respond_to })
        .map_err(|_| anyhow::anyhow!("pdfium render thread is not running"))?;
    response.recv().map_err(|_| anyhow::anyhow!("pdfium render thread dropped the response"))?
}

fn render_with_pdfium(pdfium: &Pdfium, file_path: &Path) -> anyhow::Result<Vec<u8>> {
    let document = pdfium.load_pdf_from_file(file_path, None)?;
    let page = document.pages().get(0)?;

    let render_config = PdfRenderConfig::new()
        .set_target_width(600)
        .set_maximum_height(2000)
        .rotate_if_landscape(PdfPageRenderRotation::None, false);

    let bitmap = page.render_with_config(&render_config)?;
    let image = bitmap.as_image();

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    image.to_rgb8().write_to(
        &mut std::io::Cursor::new(&mut jpeg_bytes),
        image::ImageFormat::Jpeg,
    )?;

    Ok(jpeg_bytes)
}

/// Directory the bundled pdfium shared library lives in: next to the running executable (both in
/// dev - see backend-rust/README - and in a packaged build, where it's an electron-builder
/// extraResource alongside Maktaba.Api).
fn pdfium_library_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Document, Object};

    /// Builds a minimal-but-valid single-page PDF with an Info dictionary, for metadata
    /// extraction tests - cover rendering isn't asserted on here since it depends on pdfium
    /// actually being discoverable from the test binary's directory (see `pdfium_library_dir`),
    /// which isn't guaranteed in a `cargo test` run; extraction must still succeed either way,
    /// matching the extractor's graceful "no cover" fallback.
    fn write_test_pdf(path: &Path, title: &str, author: &str) {
        let mut doc = Document::with_version("1.5");

        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );

        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });

        let info_id = doc.add_object(dictionary! {
            "Title" => Object::string_literal(title),
            "Author" => Object::string_literal(author),
            "CreationDate" => Object::string_literal("D:20240115120000"),
            "Subject" => Object::string_literal("A test subject"),
        });

        doc.trailer.set("Root", catalog_id);
        doc.trailer.set("Info", info_id);
        doc.compress();
        doc.save(path).expect("save test pdf");
    }

    #[test]
    fn extracts_title_author_date_and_subject() {
        let path = std::env::temp_dir().join(format!("maktaba-test-{}.pdf", std::process::id()));
        write_test_pdf(&path, "A Test PDF", "Grace Hopper; Ada Lovelace");

        let extractor = PdfMetadataExtractor;
        assert!(extractor.can_handle(&path));

        let metadata = extractor.extract(&path).expect("extract metadata");
        let _ = std::fs::remove_file(&path);

        assert_eq!(metadata.title, "A Test PDF");
        assert_eq!(metadata.authors, vec!["Grace Hopper", "Ada Lovelace"]);
        assert_eq!(metadata.published_date, chrono::NaiveDate::from_ymd_opt(2024, 1, 15));
        assert_eq!(metadata.description.as_deref(), Some("A test subject"));
    }

    #[test]
    fn falls_back_to_filename_when_title_is_missing() {
        let path = std::env::temp_dir().join(format!("maktaba-test-notitle-{}.pdf", std::process::id()));
        write_test_pdf(&path, "", "");

        let metadata = PdfMetadataExtractor.extract(&path).expect("extract metadata");
        let _ = std::fs::remove_file(&path);

        let expected_stem = path.file_stem().unwrap().to_string_lossy().to_string();
        assert_eq!(metadata.title, expected_stem);
        assert!(metadata.authors.is_empty());
    }
}

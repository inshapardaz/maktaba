//! EPUB metadata + cover extraction. Mirrors Maktaba.Metadata/EpubMetadataExtractor.cs, which used
//! VersOne.Epub; here we read the EPUB's own META-INF/container.xml -> OPF package document
//! directly (EPUB is just a zip of XML+content), since there's no direct Rust equivalent of that
//! library with the same metadata fidelity (identifier schemes, refined dates, cover resolution).

use std::io::Read;
use std::path::Path;

use chrono::NaiveDate;
use quick_xml::events::Event;
use quick_xml::Reader;

use maktaba_core::metadata::{BookMetadataExtractor, ExtractedBookMetadata, ExtractedIdentifier};

pub struct EpubMetadataExtractor;

impl BookMetadataExtractor for EpubMetadataExtractor {
    fn can_handle(&self, file_path: &Path) -> bool {
        file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("epub"))
            .unwrap_or(false)
    }

    fn extract(&self, file_path: &Path) -> anyhow::Result<ExtractedBookMetadata> {
        let file = std::fs::File::open(file_path)?;
        let mut zip = zip::ZipArchive::new(file)?;

        let opf_path = find_opf_path(&mut zip)?;
        let opf_bytes = read_zip_entry(&mut zip, &opf_path)?;
        let opf_dir = parent_dir(&opf_path);

        let package = parse_package(&opf_bytes)?;

        let title = if package.title.trim().is_empty() {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string()
        } else {
            package.title.trim().to_string()
        };

        let authors = package
            .creators
            .into_iter()
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect::<Vec<_>>();

        let identifiers = package
            .identifiers
            .into_iter()
            .filter(|i| !i.value.trim().is_empty())
            .map(|i| ExtractedIdentifier {
                scheme: if i.scheme.trim().is_empty() {
                    "unknown".to_string()
                } else {
                    i.scheme.to_lowercase()
                },
                value: i.value,
            })
            .collect();

        let published_date = package.dates.iter().find_map(|d| try_parse_date(d));

        let cover = package
            .cover_href
            .as_ref()
            .and_then(|href| resolve_cover(&mut zip, &opf_dir, href, &package.manifest_media_types));
        let (cover_bytes, cover_content_type) = match cover {
            Some((bytes, content_type)) => (Some(bytes), Some(content_type)),
            None => (None, None),
        };

        Ok(ExtractedBookMetadata {
            title,
            authors,
            language: package.language.filter(|s| !s.trim().is_empty()),
            publisher: package.publisher.filter(|s| !s.trim().is_empty()),
            published_date,
            description: package.description.filter(|s| !s.trim().is_empty()),
            identifiers,
            cover_image_bytes: cover_bytes,
            cover_content_type,
        })
    }
}

struct RawIdentifier {
    scheme: String,
    value: String,
}

#[derive(Default)]
struct Package {
    title: String,
    creators: Vec<String>,
    publisher: Option<String>,
    language: Option<String>,
    description: Option<String>,
    dates: Vec<String>,
    identifiers: Vec<RawIdentifier>,
    /// Item id referenced by <meta name="cover" content="..."/> (EPUB2) or the first manifest item
    /// with properties="cover-image" (EPUB3).
    cover_href: Option<String>,
    /// Manifest item href -> media-type, used to resolve the cover's content-type.
    manifest_media_types: std::collections::HashMap<String, String>,
    /// Manifest item id -> href, used to resolve an EPUB2 `<meta name="cover" content="id">` pointer.
    manifest_by_id: std::collections::HashMap<String, String>,
}

fn find_opf_path<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
) -> anyhow::Result<String> {
    let container = read_zip_entry(zip, "META-INF/container.xml")?;
    let mut reader = Reader::from_reader(container.as_slice());
    reader.trim_text(true);

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Empty(e) | Event::Start(e) if local_name_bytes(e.name().as_ref()) == b"rootfile" => {
                for attr in e.attributes().flatten() {
                    if local_name_bytes(attr.key.as_ref()) == b"full-path" {
                        return Ok(String::from_utf8_lossy(&attr.value).to_string());
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    anyhow::bail!("EPUB container.xml has no <rootfile full-path=...>");
}

fn local_name_bytes(name: &[u8]) -> &[u8] {
    match name.iter().rposition(|&b| b == b':') {
        Some(i) => &name[i + 1..],
        None => name,
    }
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn read_zip_entry<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> anyhow::Result<Vec<u8>> {
    let mut entry = zip.by_name(name)?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf)?;
    Ok(buf)
}

fn parse_package(opf_bytes: &[u8]) -> anyhow::Result<Package> {
    let mut reader = Reader::from_reader(opf_bytes);
    reader.trim_text(true);

    let mut package = Package::default();
    let mut buf = Vec::new();

    // Text-content elements we care about, and which field they map to (dc: prefix stripped).
    let mut current_text_target: Option<TextTarget> = None;
    let mut current_identifier_scheme = String::new();
    let mut text_accum = String::new();

    enum TextTarget {
        Title,
        Creator,
        Publisher,
        Language,
        Description,
        Date,
        Identifier,
    }

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let local = local_name_bytes(e.name().as_ref()).to_ascii_lowercase();
                text_accum.clear();
                current_text_target = match local.as_slice() {
                    b"title" => Some(TextTarget::Title),
                    b"creator" => Some(TextTarget::Creator),
                    b"publisher" => Some(TextTarget::Publisher),
                    b"language" => Some(TextTarget::Language),
                    b"description" => Some(TextTarget::Description),
                    b"date" => Some(TextTarget::Date),
                    b"identifier" => {
                        current_identifier_scheme = e
                            .attributes()
                            .flatten()
                            .find(|a| {
                                let n = local_name_bytes(a.key.as_ref());
                                n == b"scheme"
                            })
                            .map(|a| String::from_utf8_lossy(&a.value).to_string())
                            .unwrap_or_default();
                        Some(TextTarget::Identifier)
                    }
                    b"meta" => {
                        // EPUB2 cover pointer: <meta name="cover" content="item-id"/>
                        let attrs: std::collections::HashMap<_, _> = e
                            .attributes()
                            .flatten()
                            .map(|a| {
                                (
                                    String::from_utf8_lossy(local_name_bytes(a.key.as_ref())).to_string(),
                                    String::from_utf8_lossy(&a.value).to_string(),
                                )
                            })
                            .collect();
                        if attrs.get("name").map(|s| s.as_str()) == Some("cover") {
                            if let Some(content) = attrs.get("content") {
                                package.cover_href = Some(format!("#itemid:{content}"));
                            }
                        }
                        None
                    }
                    b"item" => {
                        handle_manifest_item(&e, &mut package);
                        None
                    }
                    _ => None,
                };
            }
            Event::Empty(e) => {
                let local = local_name_bytes(e.name().as_ref()).to_ascii_lowercase();
                match local.as_slice() {
                    b"meta" => {
                        let attrs: std::collections::HashMap<_, _> = e
                            .attributes()
                            .flatten()
                            .map(|a| {
                                (
                                    String::from_utf8_lossy(local_name_bytes(a.key.as_ref())).to_string(),
                                    String::from_utf8_lossy(&a.value).to_string(),
                                )
                            })
                            .collect();
                        if attrs.get("name").map(|s| s.as_str()) == Some("cover") {
                            if let Some(content) = attrs.get("content") {
                                package.cover_href = Some(format!("#itemid:{content}"));
                            }
                        }
                    }
                    b"item" => handle_manifest_item(&e, &mut package),
                    _ => {}
                }
            }
            Event::Text(t) => {
                text_accum.push_str(&t.unescape().unwrap_or_default());
            }
            Event::End(e) => {
                let local = local_name_bytes(e.name().as_ref()).to_ascii_lowercase();
                let is_closing_current = matches!(
                    (local.as_slice(), &current_text_target),
                    (b"title", Some(TextTarget::Title))
                        | (b"creator", Some(TextTarget::Creator))
                        | (b"publisher", Some(TextTarget::Publisher))
                        | (b"language", Some(TextTarget::Language))
                        | (b"description", Some(TextTarget::Description))
                        | (b"date", Some(TextTarget::Date))
                        | (b"identifier", Some(TextTarget::Identifier))
                );
                if is_closing_current {
                    match current_text_target.take() {
                        Some(TextTarget::Title) if package.title.is_empty() => {
                            package.title = text_accum.clone()
                        }
                        Some(TextTarget::Creator) => package.creators.push(text_accum.clone()),
                        Some(TextTarget::Publisher) if package.publisher.is_none() => {
                            package.publisher = Some(text_accum.clone())
                        }
                        Some(TextTarget::Language) if package.language.is_none() => {
                            package.language = Some(text_accum.clone())
                        }
                        Some(TextTarget::Description) if package.description.is_none() => {
                            package.description = Some(text_accum.clone())
                        }
                        Some(TextTarget::Date) => package.dates.push(text_accum.clone()),
                        Some(TextTarget::Identifier) => package.identifiers.push(RawIdentifier {
                            scheme: current_identifier_scheme.clone(),
                            value: text_accum.clone(),
                        }),
                        _ => {}
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    // Resolve an EPUB2 "#itemid:X" cover pointer to the manifest item's actual href.
    if let Some(pointer) = &package.cover_href {
        if let Some(item_id) = pointer.strip_prefix("#itemid:") {
            package.cover_href = package.manifest_by_id.get(item_id).cloned();
        }
    }

    Ok(package)
}

fn handle_manifest_item(e: &quick_xml::events::BytesStart, package: &mut Package) {
    let attrs: std::collections::HashMap<_, _> = e
        .attributes()
        .flatten()
        .map(|a| {
            (
                String::from_utf8_lossy(local_name_bytes(a.key.as_ref())).to_string(),
                String::from_utf8_lossy(&a.value).to_string(),
            )
        })
        .collect();

    let (Some(id), Some(href)) = (attrs.get("id"), attrs.get("href")) else {
        return;
    };

    package.manifest_by_id.insert(id.clone(), href.clone());

    if let Some(media_type) = attrs.get("media-type") {
        package.manifest_media_types.insert(href.clone(), media_type.clone());
    }

    // EPUB3 cover: <item properties="cover-image" href="..."/>. Only takes it if no EPUB2 <meta
    // name="cover"> pointer has already been resolved (that one is handled after the full parse).
    if package.cover_href.is_none() {
        if let Some(props) = attrs.get("properties") {
            if props.split_whitespace().any(|p| p == "cover-image") {
                package.cover_href = Some(href.clone());
            }
        }
    }
}

fn resolve_cover<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    opf_dir: &str,
    href: &str,
    media_types: &std::collections::HashMap<String, String>,
) -> Option<(Vec<u8>, String)> {
    let full_path = if opf_dir.is_empty() {
        href.to_string()
    } else {
        format!("{opf_dir}/{href}")
    };

    let bytes = read_zip_entry(zip, &full_path).ok()?;
    let content_type = media_types
        .get(href)
        .cloned()
        .unwrap_or_else(|| guess_content_type(&full_path));

    Some((bytes, content_type))
}

fn guess_content_type(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else {
        "image/jpeg".to_string()
    }
}

/// Mirrors PdfMetadataExtractor/EpubMetadataExtractor's date parsing: a full date, a bare 4-digit
/// year, or "yyyy-MM".
fn try_parse_date(raw: &str) -> Option<NaiveDate> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.date_naive());
    }
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(d);
    }
    if raw.len() == 4 {
        if let Ok(year) = raw.parse::<i32>() {
            return NaiveDate::from_ymd_opt(year, 1, 1);
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(&format!("{raw}-01"), "%Y-%m-%d") {
        return Some(d);
    }

    None
}

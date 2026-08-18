//! File-level helpers shared by import and library-rescan. Mirrors Maktaba.Data/EbookFileHelpers.cs.

use std::path::{Path, PathBuf};

use maktaba_core::entities::BookFormat;
use sha2::{Digest, Sha256};

pub fn detect_format(file_path: &Path) -> anyhow::Result<BookFormat> {
    match file_path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
        Some(ext) if ext == "epub" => Ok(BookFormat::Epub),
        Some(ext) if ext == "pdf" => Ok(BookFormat::Pdf),
        other => anyhow::bail!(
            "Unsupported ebook file type: {}",
            other.map(|e| format!(".{e}")).unwrap_or_default()
        ),
    }
}

pub fn cover_extension_for(content_type: Option<&str>) -> &'static str {
    match content_type {
        Some("image/png") => "png",
        _ => "jpg",
    }
}

pub fn compute_sha256(file_path: &Path) -> anyhow::Result<String> {
    let mut file = std::fs::File::open(file_path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hex_lower(&hasher.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Appends " (2)", " (3)", etc. before the extension until the path doesn't already exist.
pub fn get_unique_file_path(folder: &Path, file_name: &str) -> PathBuf {
    let candidate = folder.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = path.extension().and_then(|e| e.to_str());

    let mut i = 2;
    loop {
        let next_name = match ext {
            Some(ext) => format!("{stem} ({i}).{ext}"),
            None => format!("{stem} ({i})"),
        };
        let next = folder.join(next_name);
        if !next.exists() {
            return next;
        }
        i += 1;
    }
}

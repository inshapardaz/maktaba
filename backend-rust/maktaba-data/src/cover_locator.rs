//! Mirrors Maktaba.Data/CoverLocator.cs.

use std::path::{Path, PathBuf};

const COVER_CANDIDATES: &[(&str, &str)] =
    &[("cover.jpg", "image/jpeg"), ("cover.jpeg", "image/jpeg"), ("cover.png", "image/png")];

/// `book_folder_relative_path` is a Book's folder_path, relative to the library root.
pub fn find(library_root: &Path, book_folder_relative_path: &str) -> Option<(PathBuf, &'static str)> {
    let folder = library_root.join(book_folder_relative_path);
    for (file_name, content_type) in COVER_CANDIDATES {
        let path = folder.join(file_name);
        if path.is_file() {
            return Some((path, content_type));
        }
    }
    None
}

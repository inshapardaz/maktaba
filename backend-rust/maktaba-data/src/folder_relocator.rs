//! Shared on-disk folder-move logic for the "{AuthorSortName}/{Title} ({BookId})" layout. Used
//! both by single-book edits and library-wide author renames - a book's folder needs to move the
//! same way regardless of which operation changed its title or primary author's sort name.
//! Mirrors Maktaba.Data/BookFolderRelocator.cs.

use std::path::{Path, PathBuf};

use maktaba_core::ids;
use maktaba_core::naming::sanitize_path_segment;

use crate::file_helpers::get_unique_file_path;

pub struct FolderMove {
    pub old_absolute: PathBuf,
    pub new_absolute: PathBuf,
}

pub struct RelocationResult {
    /// New folder path, relative to the library root. Unchanged from the input if no move happened.
    pub new_folder_relative: String,
    /// (file_id, new file_path relative to the library root), one per input file, in the same order.
    pub updated_files: Vec<(i64, String)>,
    pub folder_move: Option<FolderMove>,
}

/// `files`: (file_id, old file_path relative to the library root) for every file on the book.
pub fn relocate_if_needed(
    library_root: &Path,
    book_id: i64,
    title: &str,
    primary_author_sort_name: &str,
    old_folder_relative: &str,
    files: &[(i64, String)],
) -> anyhow::Result<RelocationResult> {
    let new_folder_relative = format!(
        "{}/{}",
        sanitize_path_segment(primary_author_sort_name),
        sanitize_path_segment(&format!("{title} ({})", ids::encode(book_id)))
    );

    if new_folder_relative == old_folder_relative {
        return Ok(RelocationResult {
            new_folder_relative: old_folder_relative.to_string(),
            updated_files: files.to_vec(),
            folder_move: None,
        });
    }

    let old_absolute = library_root.join(old_folder_relative);
    let new_absolute = library_root.join(&new_folder_relative);

    if let Some(parent) = new_absolute.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&old_absolute, &new_absolute)?;

    // Best-effort only: a cloud-synced library folder (OneDrive/Dropbox/etc.) can hold a brief
    // lock on a directory it still considers "empty", making removal fail even though nothing is
    // actually left in it. This is pure cosmetic cleanup, not required for correctness (the book's
    // own folder has already been moved above), so a failure here must not abort the whole
    // rename/edit - the empty folder is simply left behind for the user (or a later sync/retry).
    if let Some(old_author_folder) = old_absolute.parent() {
        if let Ok(mut entries) = std::fs::read_dir(old_author_folder) {
            if entries.next().is_none() {
                let _ = std::fs::remove_dir(old_author_folder);
            }
        }
    }

    let mut updated_files = Vec::with_capacity(files.len());
    for (file_id, old_file_path) in files {
        let old_file_name = Path::new(old_file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let extension = Path::new(&old_file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let new_file_name = format!("{}{extension}", sanitize_path_segment(title));

        let new_relative_path = if old_file_name == new_file_name {
            format!("{new_folder_relative}/{old_file_name}")
        } else {
            let old_file_absolute = new_absolute.join(&old_file_name);
            let new_file_absolute = get_unique_file_path(&new_absolute, &new_file_name);
            std::fs::rename(&old_file_absolute, &new_file_absolute)?;
            let final_name = new_file_absolute
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&new_file_name)
                .to_string();
            format!("{new_folder_relative}/{final_name}")
        };

        updated_files.push((*file_id, new_relative_path));
    }

    Ok(RelocationResult {
        new_folder_relative,
        updated_files,
        folder_move: Some(FolderMove { old_absolute, new_absolute }),
    })
}

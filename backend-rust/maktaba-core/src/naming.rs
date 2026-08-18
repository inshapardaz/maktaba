//! Calibre-style sort-key helpers and filesystem-safe name sanitizing.
//! Mirrors Maktaba.Core/Naming/TitleSorting.cs and FileNaming.cs.

const LEADING_ARTICLES: [&str; 3] = ["A", "An", "The"];

pub fn compute_sort_title(title: &str) -> String {
    let trimmed = title.trim();

    for article in LEADING_ARTICLES {
        let prefix = format!("{article} ");
        if trimmed.len() >= prefix.len()
            && trimmed[..prefix.len()].eq_ignore_ascii_case(&prefix)
        {
            let rest = &trimmed[prefix.len()..];
            return format!("{rest}, {article}");
        }
    }

    trimmed.to_string()
}

pub fn compute_author_sort_name(name: &str) -> String {
    let trimmed = name.trim();
    match trimmed.rfind(' ') {
        Some(0) | None => trimmed.to_string(),
        Some(last_space) => {
            let first_names = &trimmed[..last_space];
            let last_name = &trimmed[last_space + 1..];
            format!("{last_name}, {first_names}")
        }
    }
}

/// Replaces characters invalid in file/folder names with "_" and trims trailing dots/spaces.
pub fn sanitize_path_segment(value: &str) -> String {
    const INVALID: &[char] = &[
        '<', '>', ':', '"', '/', '\\', '|', '?', '*', '\0', '\x01', '\x02', '\x03', '\x04',
        '\x05', '\x06', '\x07', '\x08', '\x09', '\x0A', '\x0B', '\x0C', '\x0D', '\x0E', '\x0F',
        '\x10', '\x11', '\x12', '\x13', '\x14', '\x15', '\x16', '\x17', '\x18', '\x19', '\x1A',
        '\x1B', '\x1C', '\x1D', '\x1E', '\x1F',
    ];

    let sanitized: String = value
        .chars()
        .map(|c| if INVALID.contains(&c) { '_' } else { c })
        .collect();
    let sanitized = sanitized.trim().trim_end_matches(['.', ' ']);

    if sanitized.is_empty() {
        "_".to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sort_title_moves_leading_article() {
        assert_eq!(compute_sort_title("The Hobbit"), "Hobbit, The");
        assert_eq!(compute_sort_title("A Study in Scarlet"), "Study in Scarlet, A");
        assert_eq!(compute_sort_title("An Odyssey"), "Odyssey, An");
        assert_eq!(compute_sort_title("Dune"), "Dune");
    }

    #[test]
    fn author_sort_name_swaps_last_name_first() {
        assert_eq!(compute_author_sort_name("J.R.R. Tolkien"), "Tolkien, J.R.R.");
        assert_eq!(compute_author_sort_name("Plato"), "Plato");
        assert_eq!(compute_author_sort_name("  Frank Herbert  "), "Herbert, Frank");
    }

    #[test]
    fn sanitize_replaces_invalid_chars() {
        assert_eq!(sanitize_path_segment("Foo: Bar/Baz"), "Foo_ Bar_Baz");
        assert_eq!(sanitize_path_segment("Trailing. "), "Trailing");
        assert_eq!(sanitize_path_segment("***"), "___");
        assert_eq!(sanitize_path_segment("   "), "_");
    }
}

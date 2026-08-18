//! Extracts metadata and a cover image from a single ebook file. One implementation per format
//! (see maktaba-metadata). Mirrors Maktaba.Core/Services/IBookMetadataExtractor.cs.

use chrono::NaiveDate;

#[derive(Debug, Clone)]
pub struct ExtractedIdentifier {
    pub scheme: String,
    pub value: String,
}

#[derive(Debug, Clone, Default)]
pub struct ExtractedBookMetadata {
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<NaiveDate>,
    pub description: Option<String>,
    pub identifiers: Vec<ExtractedIdentifier>,
    pub cover_image_bytes: Option<Vec<u8>>,
    pub cover_content_type: Option<String>,
}

pub trait BookMetadataExtractor: Send + Sync {
    fn can_handle(&self, file_path: &std::path::Path) -> bool;

    fn extract(&self, file_path: &std::path::Path) -> anyhow::Result<ExtractedBookMetadata>;
}

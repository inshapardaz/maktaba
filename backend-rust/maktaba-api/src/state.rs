use std::sync::Arc;

use maktaba_core::metadata::BookMetadataExtractor;
use maktaba_data::library_service::LibraryService;
use maktaba_data::rescan_progress::RescanProgressTracker;
use maktaba_data::services::calibre::CalibreConverter;

#[derive(Clone)]
pub struct AppState {
    pub library_service: Arc<LibraryService>,
    pub extractors: Arc<Vec<Box<dyn BookMetadataExtractor>>>,
    pub rescan_tracker: Arc<RescanProgressTracker>,
    pub calibre: Arc<CalibreConverter>,
    pub token: Option<String>,
}

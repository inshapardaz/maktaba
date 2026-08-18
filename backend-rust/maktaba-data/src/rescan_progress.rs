//! Process-wide holder for the current rescan's progress, so a separate polling request can
//! observe it while the rescan's own request is still in flight. Deliberately not persisted
//! anywhere - it only describes "right now". Mirrors Maktaba.Data/Services/RescanProgressTracker.cs.

use std::sync::Mutex;

use maktaba_core::services::RescanProgressSnapshot;

pub struct RescanProgressTracker {
    snapshot: Mutex<RescanProgressSnapshot>,
}

impl RescanProgressTracker {
    pub fn new() -> Self {
        Self { snapshot: Mutex::new(RescanProgressSnapshot::idle()) }
    }

    pub fn snapshot(&self) -> RescanProgressSnapshot {
        self.snapshot.lock().unwrap().clone()
    }

    pub fn start(&self, total: i64) {
        *self.snapshot.lock().unwrap() =
            RescanProgressSnapshot { is_running: true, processed: 0, total, current_book: None };
    }

    pub fn report(&self, processed: i64, current_book: Option<String>) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.processed = processed;
        snapshot.current_book = current_book;
    }

    pub fn complete(&self) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.is_running = false;
        snapshot.current_book = None;
    }
}

//! Thin wrapper around Calibre's `ebook-convert` CLI, if present on PATH. Mirrors
//! Maktaba.Data/Services/CalibreConverter.cs.

use std::process::Command;

pub struct CalibreConverter {
    available: bool,
}

impl CalibreConverter {
    /// Probed once at startup and cached, since checking a subprocess on every request would be
    /// wasteful and Calibre's presence doesn't change at runtime.
    pub fn new() -> Self {
        let available = Command::new("ebook-convert")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        Self { available }
    }

    pub fn is_available(&self) -> bool {
        self.available
    }

    pub fn convert(&self, source_file_path: &str, destination_file_path: &str) -> anyhow::Result<()> {
        if !self.available {
            anyhow::bail!("Calibre's ebook-convert is not available on PATH.");
        }

        let output = Command::new("ebook-convert")
            .arg(source_file_path)
            .arg(destination_file_path)
            .output()?;

        if !output.status.success() {
            anyhow::bail!(
                "ebook-convert failed (exit code {}): {}",
                output.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&output.stderr)
            );
        }

        Ok(())
    }
}

impl Default for CalibreConverter {
    fn default() -> Self {
        Self::new()
    }
}

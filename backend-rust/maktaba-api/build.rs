//! Copies the vendored pdfium shared library (see backend-rust/README.md) next to whatever binary
//! this build produces, so `cargo run`/`cargo build` "just work" for local dev the same way the
//! packaged app gets it via scripts/publish-backend.mjs. Best-effort: a missing vendor file just
//! means PDF cover thumbnails are skipped at runtime (see maktaba-metadata's pdf.rs), not a build
//! failure - useful on a machine that hasn't fetched the vendored binary yet.

use std::path::{Path, PathBuf};

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    let rid = match (target_os.as_str(), target_arch.as_str()) {
        ("windows", _) => "win-x64",
        ("macos", "aarch64") => "osx-arm64",
        ("macos", _) => "osx-x64",
        ("linux", _) => "linux-x64",
        _ => return,
    };

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let vendor_dir = manifest_dir.join("..").join("vendor").join("pdfium").join(rid);
    if !vendor_dir.is_dir() {
        return;
    }

    let Some(target_dir) = profile_dir() else { return };

    for entry in std::fs::read_dir(&vendor_dir).into_iter().flatten().flatten() {
        let dest = target_dir.join(entry.file_name());
        let _ = std::fs::copy(entry.path(), dest);
    }

    println!("cargo:rerun-if-changed={}", vendor_dir.display());
}

/// `target/<profile>/` (or `target/<triple>/<profile>/` when cross-compiling), derived from
/// `OUT_DIR` (`target/<profile>/build/<pkg>-<hash>/out`) since Cargo doesn't expose it directly.
fn profile_dir() -> Option<PathBuf> {
    let out_dir = std::env::var("OUT_DIR").ok()?;
    Path::new(&out_dir).ancestors().nth(3).map(Path::to_path_buf)
}

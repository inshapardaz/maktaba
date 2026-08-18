//! Registry of every library the user has opened, persisted to `<config dir>/Maktaba/config.json`.
//! Exactly one is "active" at a time. Mirrors Maktaba.Data/Services/LibraryService.cs.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use maktaba_core::services::LibraryRegistryEntry;
use serde::{Deserialize, Serialize};

const DATABASE_FILE_NAME: &str = "metadata.db";

pub struct LibraryInfo {
    pub path: String,
}

struct State {
    libraries: Vec<LibraryRegistryEntry>,
    library_root_path: Option<String>,
    current_library_id: Option<String>,
    schema_verified: bool,
}

pub struct LibraryService {
    config_file_path: PathBuf,
    state: RwLock<State>,
}

#[derive(Serialize, Deserialize, Default)]
struct AppConfigEntry {
    id: String,
    name: String,
    path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    #[serde(default)]
    libraries: Vec<AppConfigEntry>,
    #[serde(default, rename = "lastLibraryId")]
    last_library_id: Option<String>,
    #[serde(default, rename = "lastLibraryPath")]
    last_library_path: Option<String>,
}

impl LibraryService {
    pub fn new() -> anyhow::Result<Self> {
        // Override for integration tests, so they don't read/write the real user's config.json.
        let config_dir = match std::env::var_os("MAKTABA_CONFIG_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => dirs::config_dir()
                .ok_or_else(|| anyhow::anyhow!("could not determine the OS config directory"))?
                .join("Maktaba"),
        };
        std::fs::create_dir_all(&config_dir)?;
        let config_file_path = config_dir.join("config.json");

        let mut service = Self {
            config_file_path,
            state: RwLock::new(State {
                libraries: Vec::new(),
                library_root_path: None,
                current_library_id: None,
                schema_verified: false,
            }),
        };
        service.load_config();
        Ok(service)
    }

    fn load_config(&mut self) {
        let Ok(json) = std::fs::read_to_string(&self.config_file_path) else { return };
        let Ok(config) = serde_json::from_str::<AppConfig>(&json) else { return };

        let mut libraries: Vec<LibraryRegistryEntry> = config
            .libraries
            .into_iter()
            .map(|e| LibraryRegistryEntry { id: e.id, name: e.name, path: e.path })
            .collect();

        let mut last_library_id = config.last_library_id;

        // Migrates a pre-multi-library config.json (which only ever recorded a single
        // last_library_path) into a one-entry registry the first time it's loaded under the new
        // format - existing installs shouldn't lose their library just because this shipped.
        if libraries.is_empty() {
            if let Some(legacy_path) = config.last_library_path.filter(|p| !p.is_empty()) {
                if Path::new(&legacy_path).is_dir() {
                    let name = Path::new(&legacy_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&legacy_path)
                        .to_string();
                    let id = uuid::Uuid::new_v4().simple().to_string();
                    libraries.push(LibraryRegistryEntry { id: id.clone(), name, path: legacy_path });
                    last_library_id = Some(id);
                }
            }
        }

        let entry_to_open = last_library_id
            .as_ref()
            .and_then(|id| libraries.iter().find(|l| &l.id == id))
            .or_else(|| libraries.first())
            .cloned();

        let mut state = self.state.write().unwrap();
        state.libraries = libraries;

        if let Some(entry) = entry_to_open {
            let db_path = Path::new(&entry.path).join(DATABASE_FILE_NAME);
            if Path::new(&entry.path).is_dir() && db_path.is_file() {
                state.library_root_path = Some(entry.path.clone());
                state.current_library_id = Some(entry.id.clone());
            }
        }
    }

    fn save_config(&self) {
        let state = self.state.read().unwrap();
        let config = AppConfig {
            libraries: state
                .libraries
                .iter()
                .map(|l| AppConfigEntry { id: l.id.clone(), name: l.name.clone(), path: l.path.clone() })
                .collect(),
            last_library_id: state.current_library_id.clone(),
            last_library_path: None,
        };
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(&self.config_file_path, json);
        }
    }

    pub fn library_root_path(&self) -> Option<String> {
        self.state.read().unwrap().library_root_path.clone()
    }

    pub fn current_library_id(&self) -> Option<String> {
        self.state.read().unwrap().current_library_id.clone()
    }

    pub fn libraries(&self) -> Vec<LibraryRegistryEntry> {
        self.state.read().unwrap().libraries.clone()
    }

    pub fn database_path(&self) -> Option<PathBuf> {
        self.library_root_path().map(|root| Path::new(&root).join(DATABASE_FILE_NAME))
    }

    pub fn open(&self, path: &str) -> anyhow::Result<LibraryInfo> {
        let full_path = canonicalize_display_path(path).or_else(|_| {
            std::fs::create_dir_all(path)?;
            canonicalize_display_path(path)
        });
        let full_path_str = full_path.unwrap_or_else(|_| path.to_string());
        let full_path = PathBuf::from(&full_path_str);

        let existing = {
            let state = self.state.read().unwrap();
            state
                .libraries
                .iter()
                .find(|l| paths_equal(&l.path, &full_path_str))
                .cloned()
        };

        let entry = existing.unwrap_or_else(|| {
            let name = full_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&full_path_str)
                .to_string();
            LibraryRegistryEntry {
                id: uuid::Uuid::new_v4().simple().to_string(),
                name,
                path: full_path_str.clone(),
            }
        });

        {
            let mut state = self.state.write().unwrap();
            if !state.libraries.iter().any(|l| l.id == entry.id) {
                state.libraries.push(entry.clone());
            }
        }

        self.activate(&entry)?;
        Ok(LibraryInfo { path: full_path_str })
    }

    pub fn open_library_by_id(&self, id: &str) -> anyhow::Result<Option<LibraryInfo>> {
        let entry = {
            let state = self.state.read().unwrap();
            state.libraries.iter().find(|l| l.id == id).cloned()
        };
        let Some(entry) = entry else { return Ok(None) };

        self.activate(&entry)?;
        Ok(Some(LibraryInfo { path: entry.path }))
    }

    pub fn rename(&self, id: &str, name: &str) -> anyhow::Result<Option<LibraryRegistryEntry>> {
        let mut state = self.state.write().unwrap();
        let Some(entry) = state.libraries.iter_mut().find(|l| l.id == id) else { return Ok(None) };
        entry.name = name.to_string();
        let updated = entry.clone();
        drop(state);
        self.save_config();
        Ok(Some(updated))
    }

    pub fn relocate(&self, id: &str, new_path: &str) -> anyhow::Result<Option<LibraryRegistryEntry>> {
        let full_path_str = canonicalize_display_path(new_path).unwrap_or_else(|_| new_path.to_string());

        let (updated, is_current) = {
            let mut state = self.state.write().unwrap();
            let Some(entry) = state.libraries.iter_mut().find(|l| l.id == id) else { return Ok(None) };
            entry.path = full_path_str.clone();
            let updated = entry.clone();
            let is_current = state.current_library_id.as_deref() == Some(id);
            (updated, is_current)
        };

        if is_current {
            // The active library just moved out from under itself - re-activate in place so
            // library_root_path/database_path (and the schema-verified flag) track the new location.
            self.activate(&updated)?;
        } else {
            self.save_config();
        }

        Ok(Some(updated))
    }

    pub fn remove(&self, id: &str) -> anyhow::Result<bool> {
        let (removed, was_current, next) = {
            let mut state = self.state.write().unwrap();
            let Some(index) = state.libraries.iter().position(|l| l.id == id) else {
                return Ok(false);
            };
            state.libraries.remove(index);

            let was_current = state.current_library_id.as_deref() == Some(id);
            if was_current {
                state.library_root_path = None;
                state.current_library_id = None;
                state.schema_verified = false;
            }
            let next = state.libraries.first().cloned();
            (true, was_current, next)
        };

        if was_current {
            if let Some(next) = next {
                self.activate(&next)?;
                return Ok(removed);
            }
        }

        self.save_config();
        Ok(removed)
    }

    fn activate(&self, entry: &LibraryRegistryEntry) -> anyhow::Result<()> {
        std::fs::create_dir_all(&entry.path)?;

        {
            let mut state = self.state.write().unwrap();
            state.library_root_path = Some(entry.path.clone());
            state.current_library_id = Some(entry.id.clone());
            state.schema_verified = false;
        }

        let db_path = Path::new(&entry.path).join(DATABASE_FILE_NAME);
        crate::db::ensure_current_schema(&db_path)?;

        self.save_config();
        Ok(())
    }

    /// Verifies the current library's metadata.db matches the current schema, transparently
    /// rebuilding it if not. Checked once per opened library (cached via `schema_verified`) so
    /// this doesn't add overhead to every request. Returns true if the database was rebuilt (empty
    /// schema, no rows) and needs a rescan to repopulate it.
    pub fn ensure_current_schema(&self) -> anyhow::Result<bool> {
        {
            let state = self.state.read().unwrap();
            if state.schema_verified || state.library_root_path.is_none() {
                return Ok(false);
            }
        }

        let db_path = self
            .database_path()
            .ok_or_else(|| anyhow::anyhow!(maktaba_core::error::LibraryNotOpenError))?;
        let rebuilt = crate::db::ensure_current_schema(&db_path)?;

        self.state.write().unwrap().schema_verified = true;
        Ok(rebuilt)
    }
}

fn paths_equal(a: &str, b: &str) -> bool {
    let canon = |p: &str| canonicalize_display_path(p).map(|p| p.to_lowercase()).ok();
    match (canon(a), canon(b)) {
        (Some(a), Some(b)) => a == b,
        _ => a.eq_ignore_ascii_case(b),
    }
}

/// `std::fs::canonicalize` on Windows returns a `\\?\`-prefixed ("verbatim") path, unlike
/// .NET's `Path.GetFullPath` (which this mirrors the behavior of) - stripped here so paths shown
/// in the UI (Settings -> Libraries) and stored in config.json look like normal Windows paths.
fn canonicalize_display_path(path: &str) -> std::io::Result<String> {
    let canonical = std::fs::canonicalize(path)?;
    let display = canonical.to_string_lossy();
    Ok(display.strip_prefix(r"\\?\").unwrap_or(&display).to_string())
}

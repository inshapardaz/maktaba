//! Test harness: spawns the real `maktaba-api` binary against a scratch config dir + library
//! folder, and provides small JSON HTTP helpers. Each test gets its own isolated process/port/dirs
//! so tests can run in parallel without interfering with each other or the developer's real config.

use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

pub struct TestServer {
    child: Child,
    pub base_url: String,
    pub client: reqwest::Client,
    _config_dir: tempfile::TempDir,
    pub library_dir: tempfile::TempDir,
    /// Scratch dir for source files handed to /api/books/import - kept separate from
    /// `library_dir` since import *copies* (never moves) the source, so writing fixtures inside
    /// the library dir itself would leave the original alongside the imported copy.
    pub source_dir: tempfile::TempDir,
}

impl TestServer {
    pub async fn start() -> Self {
        Self::start_inner(None).await
    }

    /// Starts the server with bearer-token auth enabled (mirrors how the real Electron sidecar
    /// launches it - see apps/desktop/src/sidecar.ts) - `start()` above runs with no token, the
    /// auth-skipping "local dev" mode, which is what every other test in this suite wants.
    pub async fn start_with_token(token: &str) -> Self {
        Self::start_inner(Some(token)).await
    }

    async fn start_inner(token: Option<&str>) -> Self {
        let port = free_port();
        let config_dir = tempfile::tempdir().expect("create temp config dir");
        let library_dir = tempfile::tempdir().expect("create temp library dir");
        let source_dir = tempfile::tempdir().expect("create temp source dir");

        let exe = maktaba_api_exe_path();
        let mut command = Command::new(&exe);
        command.arg(format!("--port={port}")).env("MAKTABA_CONFIG_DIR", config_dir.path());
        if let Some(token) = token {
            command.arg(format!("--token={token}"));
        }
        let child = command.spawn().unwrap_or_else(|e| panic!("spawn maktaba-api at {}: {e}", exe.display()));

        let base_url = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::new();

        wait_for_health(&client, &base_url).await;

        Self { child, base_url, client, _config_dir: config_dir, library_dir, source_dir }
    }

    /// Opens `self.library_dir` as the active library - most tests need this before anything else.
    pub async fn open_library(&self) {
        let path = self.library_dir.path().to_string_lossy().to_string();
        let res = self.post("/api/libraries/open", &serde_json::json!({ "path": path })).await;
        assert!(res.status().is_success(), "open library failed: {}", res.status());
    }

    pub async fn get(&self, path: &str) -> reqwest::Response {
        self.client.get(format!("{}{}", self.base_url, path)).send().await.expect("GET request")
    }

    pub async fn post(&self, path: &str, body: &serde_json::Value) -> reqwest::Response {
        self.client.post(format!("{}{}", self.base_url, path)).json(body).send().await.expect("POST request")
    }

    pub async fn put(&self, path: &str, body: &serde_json::Value) -> reqwest::Response {
        self.client.put(format!("{}{}", self.base_url, path)).json(body).send().await.expect("PUT request")
    }

    pub async fn patch(&self, path: &str, body: &serde_json::Value) -> reqwest::Response {
        self.client.patch(format!("{}{}", self.base_url, path)).json(body).send().await.expect("PATCH request")
    }

    pub async fn delete(&self, path: &str) -> reqwest::Response {
        self.client.delete(format!("{}{}", self.base_url, path)).send().await.expect("DELETE request")
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// `target/debug/maktaba-api(.exe)`, resolved via the shared workspace target dir - Cargo's
/// `CARGO_BIN_EXE_<name>` env var only covers bins in the *same* package as the test, not a
/// sibling package's, so this is built by hand instead. Requires `maktaba-api` to already be
/// built (`cargo test --workspace` / `cargo build --workspace` does this automatically).
fn maktaba_api_exe_path() -> PathBuf {
    let exe_name = if cfg!(windows) { "maktaba-api.exe" } else { "maktaba-api" };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("target")
        .join("debug")
        .join(exe_name)
}

fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    listener.local_addr().expect("local addr").port()
}

async fn wait_for_health(client: &reqwest::Client, base_url: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(res) = client.get(format!("{base_url}/health")).send().await {
            if res.status().is_success() {
                return;
            }
        }
        if Instant::now() > deadline {
            panic!("maktaba-api did not become healthy in time");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Writes a minimal-but-valid EPUB3 file (container.xml + a package document with the given
/// title/author/identifier + one XHTML chapter) to `path`, for import/metadata-extraction tests.
pub fn write_test_epub(path: &std::path::Path, title: &str, author: &str) {
    let file = std::fs::File::create(path).expect("create epub file");
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("mimetype", options).unwrap();
    std::io::Write::write_all(&mut zip, b"application/epub+zip").unwrap();

    zip.start_file("META-INF/container.xml", options).unwrap();
    std::io::Write::write_all(
        &mut zip,
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    )
    .unwrap();

    let opf = format!(
        r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid" opf:scheme="uuid" xmlns:opf="http://www.idpf.org/2007/opf">test-{title}</dc:identifier>
    <dc:date>2024-01-15</dc:date>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>"#
    );
    zip.start_file("OEBPS/content.opf", options).unwrap();
    std::io::Write::write_all(&mut zip, opf.as_bytes()).unwrap();

    zip.start_file("OEBPS/chapter1.xhtml", options).unwrap();
    std::io::Write::write_all(
        &mut zip,
        b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Hello.</p></body></html>",
    )
    .unwrap();

    zip.start_file("OEBPS/nav.xhtml", options).unwrap();
    std::io::Write::write_all(
        &mut zip,
        b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><nav epub:type=\"toc\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><ol><li><a href=\"chapter1.xhtml\">Ch1</a></li></ol></nav></body></html>",
    )
    .unwrap();

    zip.finish().unwrap();
}

#[allow(dead_code)]
pub fn read_temp_file(path: &PathBuf) -> Vec<u8> {
    let mut buf = Vec::new();
    std::fs::File::open(path).unwrap().read_to_end(&mut buf).unwrap();
    buf
}

/// Writes a minimal-but-valid single-page PDF with an Info dictionary, for PDF import tests.
pub fn write_test_pdf(path: &std::path::Path, title: &str, author: &str) {
    use lopdf::{dictionary, Document, Object};

    let mut doc = Document::with_version("1.5");

    let pages_id = doc.new_object_id();
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });

    let info_id = doc.add_object(dictionary! {
        "Title" => Object::string_literal(title),
        "Author" => Object::string_literal(author),
        "CreationDate" => Object::string_literal("D:20240115120000"),
    });

    doc.trailer.set("Root", catalog_id);
    doc.trailer.set("Info", info_id);
    doc.compress();
    doc.save(path).expect("save test pdf");
}

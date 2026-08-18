//! End-to-end smoke coverage against the real `maktaba-api` binary over HTTP - the Rust
//! replacement for Maktaba.Tests (which was a single placeholder test with no real coverage).
//! Exercises the same request/response shapes the frontend's apps/frontend/src/api.ts calls.

mod common;

use common::TestServer;

#[tokio::test]
async fn health_check_responds_ok() {
    let server = TestServer::start().await;
    let res = server.get("/health").await;
    assert!(res.status().is_success());
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn bearer_token_auth_is_enforced_when_a_token_is_configured() {
    let token = "test-secret-token";
    let server = TestServer::start_with_token(token).await;

    // /health is always unauthenticated, even with a token configured.
    let health_res = server.get("/health").await;
    assert!(health_res.status().is_success());

    // No Authorization header at all.
    let no_auth = server.client.get(format!("{}/api/libraries/current", server.base_url)).send().await.unwrap();
    assert_eq!(no_auth.status(), 401);

    // Wrong token.
    let wrong_token = server
        .client
        .get(format!("{}/api/libraries/current", server.base_url))
        .header("Authorization", "Bearer not-the-right-token")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_token.status(), 401);

    // Correct token via the Authorization header.
    let correct = server
        .client
        .get(format!("{}/api/libraries/current", server.base_url))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert!(correct.status().is_success());

    // Correct token via ?access_token= (used for <img> cover URLs, which can't set headers).
    let via_query = server
        .client
        .get(format!("{}/api/libraries/current?access_token={token}", server.base_url))
        .send()
        .await
        .unwrap();
    assert!(via_query.status().is_success());
}

#[tokio::test]
async fn books_endpoint_without_open_library_returns_400() {
    let server = TestServer::start().await;
    let res = server.get("/api/books").await;
    assert_eq!(res.status(), 400);
}

#[tokio::test]
async fn open_library_creates_it_and_reports_current() {
    let server = TestServer::start().await;
    server.open_library().await;

    let res = server.get("/api/libraries/current").await;
    assert!(res.status().is_success());
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(
        body["path"],
        server.library_dir.path().to_string_lossy().to_string(),
    );
}

#[tokio::test]
async fn import_epub_then_list_and_get_detail() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("source.epub");
    common::write_test_epub(&epub_path, "The Great Test", "Ada Lovelace");

    let import_res = server
        .post(
            "/api/books/import",
            &serde_json::json!({ "filePath": epub_path.to_string_lossy() }),
        )
        .await;
    assert_eq!(import_res.status(), 201, "import failed: {:?}", import_res.text().await);
    let import_body: serde_json::Value = import_res.json().await.unwrap();
    let book_id = import_body["id"].as_str().unwrap().to_string();

    let list_res = server.get("/api/books").await;
    assert!(list_res.status().is_success());
    let books: Vec<serde_json::Value> = list_res.json().await.unwrap();
    assert_eq!(books.len(), 1);
    // The leading article moves to the end in the sort title, matching TitleSorting's C#-mirrored rule.
    assert_eq!(books[0]["title"], "The Great Test");
    assert_eq!(books[0]["authors"][0], "Ada Lovelace");
    assert_eq!(books[0]["readingStatus"], "Unread");

    let detail_res = server.get(&format!("/api/books/{book_id}")).await;
    assert!(detail_res.status().is_success());
    let detail: serde_json::Value = detail_res.json().await.unwrap();
    assert_eq!(detail["title"], "The Great Test");
    assert_eq!(detail["sortTitle"], "Great Test, The");
    assert_eq!(detail["language"], "en");
    assert_eq!(detail["datePublished"], "2024-01-15");

    // The book's own folder should now exist on disk (named by the author's *sort* name -
    // "Lovelace, Ada" - alongside metadata.db) with a copied .epub file.
    let author_dirs: Vec<_> = std::fs::read_dir(server.library_dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    assert_eq!(author_dirs.len(), 1, "expected exactly one author folder");
    assert_eq!(author_dirs[0].file_name().to_string_lossy(), "Lovelace, Ada");
}

#[tokio::test]
async fn import_pdf_then_get_detail() {
    let server = TestServer::start().await;
    server.open_library().await;

    let pdf_path = server.source_dir.path().join("source.pdf");
    common::write_test_pdf(&pdf_path, "A PDF Book", "PDF Author");

    let import_res = server.post("/api/books/import", &serde_json::json!({ "filePath": pdf_path.to_string_lossy() })).await;
    assert_eq!(import_res.status(), 201, "import failed: {:?}", import_res.text().await);
    let book_id = import_res.json::<serde_json::Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    let detail: serde_json::Value = server.get(&format!("/api/books/{book_id}")).await.json().await.unwrap();
    assert_eq!(detail["title"], "A PDF Book");
    assert_eq!(detail["authors"][0], "PDF Author");
    assert_eq!(detail["files"][0]["format"], "Pdf");

    // Importing a second, otherwise-identical PDF must not crash the server - this is exactly
    // the scenario that used to trip pdfium's "bind fresh on every render" bug (see
    // maktaba-metadata's pdf.rs), which crashed the whole process on the second PDF.
    let pdf_path_2 = server.source_dir.path().join("source2.pdf");
    common::write_test_pdf(&pdf_path_2, "A Second PDF Book", "PDF Author");
    let import_res_2 = server.post("/api/books/import", &serde_json::json!({ "filePath": pdf_path_2.to_string_lossy() })).await;
    assert_eq!(import_res_2.status(), 201, "second PDF import failed: {:?}", import_res_2.text().await);
}

#[tokio::test]
async fn importing_the_same_file_twice_reports_a_duplicate() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("dup.epub");
    common::write_test_epub(&epub_path, "Duplicate Me", "Some Author");

    let first = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    assert_eq!(first.status(), 201);

    let second = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    assert_eq!(second.status(), 409);
    let body: serde_json::Value = second.json().await.unwrap();
    assert_eq!(body["duplicate"]["sameContentHash"], true);
}

#[tokio::test]
async fn edit_book_updates_metadata_and_reading_status() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("edit.epub");
    common::write_test_epub(&epub_path, "Editable Book", "Original Author");
    let import_res = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    let book_id = import_res.json::<serde_json::Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    let edit_res = server
        .put(
            &format!("/api/books/{book_id}"),
            &serde_json::json!({
                "title": "Renamed Book",
                "authors": ["New Author"],
                "language": "fr",
                "publisher": null,
                "publishedDate": null,
                "description": "A description.",
                "rating": 4,
                "seriesName": "A Series",
                "seriesIndex": 1.0,
                "tags": ["fiction", "test"],
                "collectionIds": []
            }),
        )
        .await;
    assert_eq!(edit_res.status(), 204, "edit failed: {:?}", edit_res.text().await);

    let detail: serde_json::Value = server.get(&format!("/api/books/{book_id}")).await.json().await.unwrap();
    assert_eq!(detail["title"], "Renamed Book");
    assert_eq!(detail["authors"][0], "New Author");
    assert_eq!(detail["rating"], 4);
    assert_eq!(detail["seriesName"], "A Series");
    assert_eq!(detail["tags"].as_array().unwrap().len(), 2);

    let status_res = server.patch(&format!("/api/books/{book_id}/status"), &serde_json::json!({ "readingStatus": "Reading" })).await;
    assert_eq!(status_res.status(), 204);
    let detail: serde_json::Value = server.get(&format!("/api/books/{book_id}")).await.json().await.unwrap();
    assert_eq!(detail["readingStatus"], "Reading");
}

#[tokio::test]
async fn bookmarks_notes_and_progress_round_trip() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("reader.epub");
    common::write_test_epub(&epub_path, "Reader Data Book", "Author");
    let import_res = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    let book_id = import_res.json::<serde_json::Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    let bookmark_id = "bm-1";
    let save_res = server
        .put(
            &format!("/api/books/{book_id}/bookmarks/{bookmark_id}"),
            &serde_json::json!({
                "chapterId": "ch1", "position": 0.5, "name": "My bookmark",
                "createdAt": "2024-01-01T00:00:00Z", "updatedAt": null
            }),
        )
        .await;
    assert_eq!(save_res.status(), 204);

    let bookmarks: Vec<serde_json::Value> = server.get(&format!("/api/books/{book_id}/bookmarks")).await.json().await.unwrap();
    assert_eq!(bookmarks.len(), 1);
    assert_eq!(bookmarks[0]["id"], bookmark_id);

    let del_res = server.delete(&format!("/api/books/{book_id}/bookmarks/{bookmark_id}")).await;
    assert_eq!(del_res.status(), 204);
    let bookmarks: Vec<serde_json::Value> = server.get(&format!("/api/books/{book_id}/bookmarks")).await.json().await.unwrap();
    assert!(bookmarks.is_empty());

    let note_id = "note-1";
    let save_note = server
        .put(
            &format!("/api/books/{book_id}/notes/{note_id}"),
            &serde_json::json!({
                "chapterId": "ch1", "startOffset": 0, "endOffset": 10, "text": "excerpt", "comment": "a comment",
                "createdAt": "2024-01-01T00:00:00Z", "updatedAt": null
            }),
        )
        .await;
    assert_eq!(save_note.status(), 204);
    let notes: Vec<serde_json::Value> = server.get(&format!("/api/books/{book_id}/notes")).await.json().await.unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0]["comment"], "a comment");

    let progress_before: serde_json::Value = server.get(&format!("/api/books/{book_id}/progress")).await.json().await.unwrap();
    assert!(progress_before.is_null());

    let save_progress = server
        .put(&format!("/api/books/{book_id}/progress"), &serde_json::json!({ "percentage": 42.5, "chapterId": "ch1", "position": 0.25 }))
        .await;
    assert_eq!(save_progress.status(), 204);
    let progress: serde_json::Value = server.get(&format!("/api/books/{book_id}/progress")).await.json().await.unwrap();
    assert_eq!(progress["percentage"], 42.5);
    assert_eq!(progress["chapterId"], "ch1");

    // continue-reading should now surface this book since it has saved progress.
    let continue_reading: Vec<serde_json::Value> = server.get("/api/books/continue-reading").await.json().await.unwrap();
    assert_eq!(continue_reading.len(), 1);
    assert_eq!(continue_reading[0]["id"], book_id);
}

#[tokio::test]
async fn browse_endpoints_report_counts() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("browse.epub");
    common::write_test_epub(&epub_path, "Browse Book", "Browse Author");
    server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;

    let authors: Vec<serde_json::Value> = server.get("/api/authors").await.json().await.unwrap();
    assert_eq!(authors.len(), 1);
    assert_eq!(authors[0]["name"], "Browse Author");
    assert_eq!(authors[0]["bookCount"], 1);

    let statuses: Vec<serde_json::Value> = server.get("/api/reading-statuses").await.json().await.unwrap();
    assert_eq!(statuses.len(), 3);
    let unread = statuses.iter().find(|s| s["status"] == "Unread").unwrap();
    assert_eq!(unread["count"], 1);
}

#[tokio::test]
async fn collections_can_be_created_listed_and_deleted() {
    let server = TestServer::start().await;
    server.open_library().await;

    let create_res = server.post("/api/collections", &serde_json::json!({ "name": "Favorites" })).await;
    assert_eq!(create_res.status(), 201);
    let created: serde_json::Value = create_res.json().await.unwrap();
    let collection_id = created["id"].as_str().unwrap().to_string();

    let list: Vec<serde_json::Value> = server.get("/api/collections").await.json().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["bookCount"], 0);

    let del_res = server.delete(&format!("/api/collections/{collection_id}")).await;
    assert_eq!(del_res.status(), 204);
    let list: Vec<serde_json::Value> = server.get("/api/collections").await.json().await.unwrap();
    assert!(list.is_empty());
}

#[tokio::test]
async fn rescan_rebuilds_the_index_from_disk_and_preserves_rating() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("rescan.epub");
    common::write_test_epub(&epub_path, "Rescan Book", "Rescan Author");
    let import_res = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    let book_id = import_res.json::<serde_json::Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    let edit_res = server
        .put(
            &format!("/api/books/{book_id}"),
            &serde_json::json!({
                "title": "Rescan Book", "authors": ["Rescan Author"], "language": null, "publisher": null,
                "publishedDate": null, "description": null, "rating": 5, "seriesName": null, "seriesIndex": null,
                "tags": [], "collectionIds": []
            }),
        )
        .await;
    assert_eq!(edit_res.status(), 204);

    let libraries: Vec<serde_json::Value> = server.get("/api/libraries").await.json().await.unwrap();
    let library_id = libraries[0]["id"].as_str().unwrap().to_string();

    let resync_res = server.post(&format!("/api/libraries/{library_id}/resync"), &serde_json::json!({})).await;
    assert_eq!(resync_res.status(), 200);
    let resync_body: serde_json::Value = resync_res.json().await.unwrap();
    assert_eq!(resync_body["bookCount"], 1);

    // Same folder-embedded id survives the rescan, and the DB-only rating field was preserved.
    let detail: serde_json::Value = server.get(&format!("/api/books/{book_id}")).await.json().await.unwrap();
    assert_eq!(detail["title"], "Rescan Book");
    assert_eq!(detail["rating"], 5);
}

#[tokio::test]
async fn delete_book_removes_it_and_reports_its_folder() {
    let server = TestServer::start().await;
    server.open_library().await;

    let epub_path = server.source_dir.path().join("delete.epub");
    common::write_test_epub(&epub_path, "Delete Book", "Delete Author");
    let import_res = server.post("/api/books/import", &serde_json::json!({ "filePath": epub_path.to_string_lossy() })).await;
    let book_id = import_res.json::<serde_json::Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    let del_res = server.delete(&format!("/api/books/{book_id}")).await;
    assert_eq!(del_res.status(), 200);
    let body: serde_json::Value = del_res.json().await.unwrap();
    // Folder is named by the author's *sort* name ("Author, Delete"), not the raw "Delete Author".
    assert!(body["folderPath"].as_str().unwrap().contains("Author, Delete"));

    let get_res = server.get(&format!("/api/books/{book_id}")).await;
    assert_eq!(get_res.status(), 404);
}

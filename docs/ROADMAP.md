# Roadmap

Planned work not yet scheduled to a milestone. Unlike `docs/SPEC.md`/`docs/TASKS.md` (which
describe past milestones and are known to be stale in places), this file is meant to stay current
as a living backlog — add items here as they come up, move them out (or delete the entry) once
built.

## Recently built

- **Rename an author, updating all their books** — `PUT /api/authors/{id}/name`
  (`backend/Maktaba.Api/Endpoints/AuthorEndpoints.cs`), backed by `IAuthorRenameService`
  (`backend/Maktaba.Data/Services/AuthorRenameService.cs`). Cascades to every book by that author:
  updates the `Author` row (`Name`/`SortName`), and for each book where they're the *primary*
  (first-listed) author, relocates the on-disk folder to match — reuses the exact same move logic
  `BookEditService` already used for a single-book edit, now extracted into a shared
  `BookFolderRelocator.RelocateIfNeeded` (`backend/Maktaba.Data/BookFolderRelocator.cs`) so both
  call sites stay in sync. **Deliberate scope decision**: a rename that collides with an existing
  author's name (case-insensitive) is *rejected* with 409, not merged into the existing author —
  merging would mean silently combining two authors' book lists and deleting a row, which felt like
  a decision that deserved an explicit ask rather than something to do unattended. If merge-on-
  collision turns out to be wanted, that's a deliberate follow-up, not an oversight.
  Frontend: inline rename (pencil icon → editable row) in `AuthorsView.tsx`.

- **Rename a tag, updating all its books** — `PUT /api/tags/{id}/name`
  (`backend/Maktaba.Api/Endpoints/TagEndpoints.cs`), inline in the endpoint (no dedicated service —
  unlike authors, tags have no on-disk folder implication, so there's no filesystem work to
  isolate/test separately). Same 409-on-collision behavior as the author rename, same rationale.
  Frontend: same inline-rename UI pattern in `TagsView.tsx`.

- **Series in the sidebar** — `Sidebar.tsx`'s Series section is now capped to the top 5 (by book
  count) with a "see all" chevron, matching Authors/Collections/Tags, opening a new
  `SeriesView.tsx`. Note: this mirrors `AuthorsView.tsx` (plain search + list), not
  `CollectionsView.tsx` (create/delete) — Series, like Authors and Tags, are find-or-created from
  file metadata (`EntityResolvers.ResolveSeriesAsync`), not user-authored the way Collections are,
  so a "create a new series here" action wouldn't fit. Series rename wasn't added (wasn't asked
  for) even though the pattern would be a near-copy of the tag rename — worth a quick add later if
  wanted.

- **`BookEditForm.tsx` overhaul**: Authors is now a creatable `MultiSelect` (search existing names,
  or add one that isn't found yet), Series a creatable single `Select`, Tags a creatable
  `MultiSelect`, and Publisher an `Autocomplete` suggesting from every publisher already in the
  library (new `GET /api/publishers` endpoint — bare distinct strings, not a `BrowseGroupDto`,
  since Publisher isn't its own entity/table). The "creatable" behavior is hand-rolled
  (`buildCreatableData` in `BookEditForm.tsx`) since Mantine dropped built-in `creatable` support
  after v6 — dropdown data is always (existing names ∪ currently-selected values) plus a synthetic
  "Create "X"" entry appended only when the typed search doesn't already match something; selecting
  it just selects that literal string, and find-or-create still happens server-side exactly as
  before. The "details" fields (publisher/language/published-date/rating) moved above
  authors/series/tags/collections, per the original ask.

  **Not yet visually verified** — this sandbox can't launch the Electron GUI. The creatable-select
  dropdown behavior (does "Create "X"" render and select correctly, does clearing/re-selecting
  behave) needs a check with `npm run dev`; backend endpoints were verified via `dotnet build` +
  a DbContext/filesystem-level test harness (real folder moves, collision rejection, rescan
  preservation), not a live HTTP round-trip through the running app.

## Notes

None of the above have further planning docs — if something here needs revisiting (e.g. deciding
on merge-on-collision for author/tag rename, or adding series rename), treat it as its own planning
pass rather than assuming the choices above are final.

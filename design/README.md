# Handoff: Codex — E-book Management Application

## Overview
Codex is a desktop e-book library manager (Calibre-style): browse/search a book collection, view details, read in-app, edit metadata, import/convert files, and manage tags/collections. Includes full RTL support with an English/Urdu language toggle.

## About the Design Files
The files in `design/` are **design references built in HTML** (a live interactive prototype), not production code. They show intended layout, styling, copy, and interaction behavior. The task is to **recreate this design in the target codebase's environment** (likely Electron + React, given the product is a desktop app) using its existing patterns/libraries — or, if no environment exists yet, choose the most appropriate stack and implement there. Do not ship the HTML file directly.

Open `design/Codex Library.dc.html` in a browser to interact with the live prototype — click through books, toggle grid/list, open the drawer, reader, metadata editor, import dialog, collections manager, and the EN/Urdu switch.

## Fidelity
**High-fidelity.** Colors, type, spacing, and component styling are final and come from the attached "Classical" design system (`design/styles.css` — link this or port its CSS variables into your codebase's token system). Content/copy is final for English and Urdu. Recreate pixel-perfectly using your codebase's component library, substituting in the design system's tokens for any hardcoded values.

## Design System
Built on **Classical**: an editorial, book-like system — Cormorant Garamond headings over Lora body, hairline rules, outlined (not filled) buttons, color used as stroke/text rather than fill. Full guide in `design/design-system-readme.md`; tokens in `design/styles.css` (`--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*`). Reuse `.btn`, `.tag`, `.field`/`.input`, `.seg`, `.card`, `.table`, `.dialog`, `.hr` classes as component references — port their CSS rules into your component library.

## Screens / Views

### 1. Top toolbar (persistent, all screens)
- Height 60px, bottom border 1px `--color-divider`, horizontal flex, `gap: var(--space-4)`, padding `0 var(--space-5)`.
- "Codex" wordmark: `--font-heading`, weight `--font-heading-weight`, 22px.
- Vertical 1px divider, then a dimmed (60% opacity) 13px header label showing current view context (e.g. "All books", "Kindle Paperwhite", "Author: Jane Austen").
- Search field: bordered box (`--color-surface` bg, `--color-divider` border, `--radius-sm`, 36px tall, 280px wide) with a search icon + text input, filters books live by title/author (case-insensitive substring).
- Grid/List segmented control (`.seg`) with icon + label each.
- EN / اردو segmented language toggle (Urdu label set in Noto Nastaliq Urdu).
- Primary "Import books" button (`.btn-primary`) with an upload icon, opens the Import dialog.

### 2. Library — Sidebar (left, or right in RTL)
232px wide, scrollable, border on the trailing edge (right in LTR, left in RTL — mirrors with direction). Padding `var(--space-5) var(--space-4)`, vertical stack `gap: var(--space-5)`.
Sections, each with a small-caps 10.5px uppercase label at 50% opacity:
- **Library**: "My Library" (book icon) and "Kindle Paperwhite" (device), each with a book count. Clicking switches the active source; active item shows accent-700 text, weight 600, full icon opacity.
- **Authors**: list of all authors sorted by book count descending, each row shows name + count; active filter gets accent-100 background tint, accent-700 text, weight 600.
- **Series**: same pattern, series names.
- **Tags**: wrapped pill row using `.tag` classes (neutral by default, accent when active as filter).
- **Collections**: header row has a "Manage" link (opens Collections dialog) at accent-700. List below same active-row pattern as Authors, with a folder icon.
- **Reading status**: Unread / Reading / Finished, same active-row pattern, with live counts.
- Bottom-pinned: hairline rule + "Settings" row (gear icon) that swaps main content to the Preferences screen.

Filters are single-select and mutually exclusive with device selection; selecting a nav item sets `headerLabel` context text and re-filters the book list. Only one filter/device active at a time in this design (not additive).

### 3. Library — Grid view (default)
Book count label (12.5px, 50% opacity) above a responsive grid: `grid-template-columns: repeat(auto-fill, minmax(148px,1fr))`, `gap: var(--space-5)`.
Each book card:
- Cover: `aspect-ratio: 2/3`, 1px `--color-divider` border, `--radius-sm`, `--shadow-sm`. Since no cover art exists, the cover is a solid "spine" color panel (cycles through 6 tones from the accent/neutral ramps by book id) with white text: top-left genre/tag label (10px uppercase), a `--font-heading` title (18px) centered vertically via flex, and author name at bottom (10.5px).
- A status chip (opaque `--color-bg` surface, `--color-divider` border, `--radius-sm`, `--shadow-sm`, 10px text) floats top-right (top-left in RTL) on the cover, shown for "Reading" and "Finished" only (not "Unread").
- Below the cover: title (13px, weight 600, 2-line clamp) and author (12px, 55% opacity).
- Clicking a card opens the Details drawer.
- Empty state: centered "No books match this view." at 50% opacity when a filter/search yields zero results.

### 4. Library — List view
Toggled via the segmented control. Uses `.table` component: columns Title, Author, Series, Tags, Format, Status. Series/Tags/Format cells use muted text style. Status column uses a `.tag` (accent for Finished, outline for Reading, neutral for Unread). Row click opens the same Details drawer. Same book-count label and empty state as grid.

### 5. Book Details drawer
Slides in from the trailing edge (right in LTR / left in RTL), 392px wide, full height, `--color-bg` background, leading-edge border, `--shadow-lg`, scrollable, padding `var(--space-5)`, vertical stack `gap: var(--space-4)`. A semi-transparent (15% opacity neutral-900) backdrop covers the rest of the screen; clicking it or the close (X) icon button closes the drawer.
Content top to bottom:
- Close button (ghost icon button), right-aligned.
- Header row: 112px-wide spine-style cover (same treatment as grid cards, smaller text) + title (21px), author (60% opacity, 13.5px), and tag pills (`.tag-outline`).
- Reading-status segmented control (Unread/Reading/Finished) — changes are per-book overrides.
- Hairline rule, then a justified 14px description paragraph, then another hairline rule.
- A 2-column key/value table: Series, Format, Published (year), Added (date). Labels at 55% opacity; values end-aligned (mirrors in RTL).
- Action stack pinned to the bottom: primary full-width "Read" button (opens Reader), a row of two secondary buttons "Edit metadata" / "Convert…" (opens Metadata Editor / Import dialog), and a ghost full-width "Remove from library" button.

### 6. Reader (full-screen overlay)
Fixed, covers viewport, `--color-bg`, z-index above everything.
- 52px header bar: close (X) icon button (left), centered title + author (13px, 60% opacity), spacer to balance.
- Scrollable content area, centered column max-width 560px, padding `var(--space-8) var(--space-6)`: small uppercase "Chapter I" kicker, `<h1>` book title, justified body paragraph (16.5px, line-height 1.75) showing the book's opening line as sample text.
- 44px footer bar, centered "Page 1 of N" label (12px, 55% opacity), top border.

### 7. Metadata Editor (modal dialog, 480px wide)
Standard `.dialog` / `.dialog-backdrop`. Title "Edit metadata". Body: stacked `.field` inputs — Title, Author, Series, Tags (comma-separated single-line input), Description (4-row textarea). Actions: secondary "Cancel", primary "Save" (writes back to the in-memory book record).

### 8. Import & Conversion dialog (modal, 520px wide)
Title "Import & convert". Body:
- Dashed-border drop zone (`--radius-md`, centered, padding `var(--space-5)`) with an upload icon and "Drop EPUB, MOBI or PDF files here, or **browse**" (browse is an accent-700 underlined inline link).
- "Convert to" field: segmented control of EPUB/MOBI/AZW3/PDF.
- Import queue: list of file rows (filename icon, filename, file size, status tag) — border box per row. Starts with 3 sample queued files, each tag `.tag-neutral` "Queued".
- Actions: secondary "Cancel", primary "Start import" — clicking it flips every queued row's status tag to accent "Converted" (simulated instant conversion; a real implementation should show per-file progress/errors).

### 9. Collections Manager (modal, 420px wide)
Title "Manage collections". Body: list of existing collections (name, count " N books", ghost trash icon-button to delete) each row divided by a hairline bottom border. Below: inline add row — text input "New collection name" + secondary "Add" button. Actions: primary "Done" to close.

### 10. Preferences / Settings (replaces main content, not a modal)
Max-width 760px column, `h1` "Preferences" + subtitle, hairline-divided sections:
- **Library location**: folder path text field + secondary "Browse…" button (stub, no file-picker wired).
- **Import & conversion defaults**: default output format (segmented EPUB/MOBI/AZW3/PDF); "Fetch metadata automatically from" — checkboxes for Open Library, Google Books, Goodreads (Goodreads off by default).
- **Connected devices**: bordered row showing "Kindle Paperwhite" device icon, book count + free space ("X books · 6.2 GB free"), ghost "Forget device" button.
- Primary "Save changes" button returns to Library.

## RTL / Localization Behavior
- Language toggle (EN / اردو) sets `dir="rtl"` on the app root and swaps `--font-body` for Noto Nastaliq Urdu across UI chrome text.
- **Book titles and author names are never translated** — they stay in their original (English) language regardless of UI locale. Only interface chrome, labels, status values, and genre/tag labels are translated.
- Layout fully mirrors: sidebar border and drawer slide-in side flip sides, status chip on covers flips corner, table cell end-alignment flips, drop-cap style pull-quotes etc. all use logical "start/end" via computed `startAlign`/`endAlign` rather than hardcoded left/right.
- All UI copy strings exist in parallel EN/UR dictionaries (see Design Tokens/Content below) — port this as your app's i18n string table structure (flat key → string per locale).

## Interactions & Behavior
- Sidebar nav items, tags, and status rows are single-select filters; clicking toggles the book list and the toolbar header label to reflect the active filter context. Clicking "My Library" or the device row clears filters.
- Search live-filters by substring match on title or author (case-insensitive), combined with any active nav filter.
- No animation/transition timings are specified in this prototype (state changes are instant swaps) — use standard, subtle transitions consistent with your codebase's existing motion patterns (e.g. 150–200ms ease for drawer slide-in, dialog fade/scale).
- No loading or error states are modeled in this prototype (all data is static/in-memory) — the target implementation should design real loading/error states for import, conversion, and metadata fetch, consistent with the rest of the app.
- No responsive/mobile behavior is defined — this is a desktop-only layout.

## State Management
Reference state shape from the prototype (adapt to your app's state layer):
- `lang`: 'en' | 'ur'
- `mainView`: 'library' | 'settings'
- `viewMode`: 'grid' | 'list'
- `search`: string
- `filterType` / `filterValue`: current single active filter (author/series/tag/collection/status) or null
- `device`: 'library' | 'kindle' — active library/device source
- `selectedId`: id of book shown in the details drawer (null = closed)
- `readerId`: id of book open in the reader (null = closed)
- `metadataOpen` / `draft`: metadata editor dialog + its editable draft copy of the selected book
- `importOpen` / `importFormat` / `importQueue` / `importedOnce`: import dialog state and simulated conversion queue
- `collectionsOpen` / `collections` / `newCollectionName`: collections manager state
- `statusOverrides`: map of bookId → reading status (drawer status control writes here rather than mutating the source record)
- `libraryPath`, `defaultFormat`, `metadataSources`: settings screen state

Data requirements for a real implementation: a persistent book library store (metadata + file paths + covers), device sync detection (e.g. Kindle mount detection), an actual EPUB/MOBI/PDF/AZW3 converter (e.g. Calibre's conversion pipeline or a library like `epub-gen`/`calibre-cli` shellout), and real cover image extraction/storage (the prototype uses solid-color placeholder "spines" since no cover art is provided).

## Design Tokens
All tokens are defined as CSS custom properties in `design/styles.css` — do not hardcode values, reference the variables (or port them into your codebase's token system):
- **Color**: `--color-bg`, `--color-text`, `--color-surface`, `--color-divider`, `--color-neutral-100…900`, `--color-accent-100…900` (base accent `--color-accent` ≈ #b68235, ground `--color-bg` ≈ #f3f2f2, text `--color-text` ≈ #201f1d). Mono accent scheme — `--color-accent-2-*` is a redundant stand-in, not a second brand color.
- **Type**: `--font-heading` (Cormorant Garamond), `--font-body` (Lora), `--font-heading-weight` (semibold, never bold). Urdu UI chrome uses "Noto Nastaliq Urdu" (loaded via Google Fonts) in place of `--font-body`.
- **Spacing**: `--space-1` … `--space-8` scale (1.15× density).
- **Radius**: `--radius-sm`, `--radius-md`.
- **Shadow**: `--shadow-sm`, `--shadow-lg`.
- Specific one-off sizes used directly in the prototype (not tokenized, kept as literal px in the HTML): toolbar height 60px, sidebar width 232px, drawer width 392px, reader header/footer 52px/44px, drawer cover 112px, grid cover card min-width 148px.

## Content (English / Urdu strings)
All interface copy is in `Codex Library.dc.html`'s `EN` / `UR` JS objects near the top of the script block — treat this as the canonical source for every UI string in both languages (labels, buttons, dialog titles, table headers, placeholders, etc.), plus `TAG_UR` and `STATUS_UR` lookup maps for translating genre tags and reading-status values. Sample book data (18 classic-literature titles with title/author/tags/status/description/opening line) is illustrative placeholder content for the prototype, not final production content.

## Assets
No image/icon files — icons are inline SVGs (Lucide icon set, per the Classical design system's icon guidance: https://lucide.dev — same stroke-based line icons used throughout, recreate with your icon library of choice or vendor Lucide directly). No photographs or cover art images are used; book covers are CSS-only solid-color "spine" placeholders standing in for real cover artwork.

## Files
- `design/Codex Library.dc.html` — the full interactive prototype (all 6 screens + RTL variant, live/clickable).
- `design/styles.css` — the Classical design system stylesheet (all design tokens + component CSS).
- `design/design-system-readme.md` — full Classical design system usage guide.

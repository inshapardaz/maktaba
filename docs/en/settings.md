# Settings & Preferences

Open **Settings** from the sidebar to adjust how Maktaba looks and behaves. Settings is organized
into tabs:

- **General** — app language, appearance (theme and color scheme), Urdu font, the title bar's
  menu button, and whether periodical issues show up in the main book grid.
- **Libraries** — see every library you've ever opened, switch between them, rename, move, or
  remove one, re-scan a library's folder if you've added or moved files outside of Maktaba, and
  turn the [Periodicals](organizing.md#periodicals) feature on or off per library.
- **Reading** — how the reader window opens, which reading engine is used for EPUB/PDF, and
  whether reading status updates automatically as you read.
- **Dictionaries** — set up an offline dictionary per language so you can look up word meanings
  while reading, without needing an internet connection.
- **About** — the version of Maktaba you're running, and whether an update is available.

This help documentation lives in its own window instead of a Settings tab — click the **Help**
button (the "?" icon) in the title bar, or use the **Maktaba Help** item in the app menu, to open
it. The Help window also has a **Replay Getting Started Tour** button.

## Switching languages

Maktaba's own menus and this help documentation are both available in English and Urdu. Change
the app's language any time from **Settings → General**; the whole app switches immediately, no
restart needed.

## Appearance

From **Settings → General** you can pick:

- **Theme** — **Organic**, Maktaba's default warm, rounded design, or **White**, a plain,
  unstyled look for anyone who prefers it.
- **Color scheme** — toggle between a light and dark version of whichever theme you've chosen,
  using the sun/moon button.
- **Urdu font** — which font is used to display Urdu text throughout the app and in the reader.

## Menu bar and periodical display

Also under **Settings → General**:

- **Menu bar** — shows the File/Edit/View menu in reader windows and a menu button in the title
  bar, for anyone who prefers a traditional application menu.
- **Show issues in the main grid** — when off, periodical issues only appear under Periodicals in
  the sidebar, keeping your main book list to standalone books; when on, issues are mixed in with
  the rest of your books too.

## Reading preferences

From **Settings → Reading** you can choose:

- **Reader window** — whether opening a book pops out its own window (the default) or opens
  inline within the library window.
- **EPUB reader** and **PDF reader** — each can use Maktaba's **built-in** reader engine, or an
  **external** one if you've configured one; Maktaba warns you when an external engine is
  selected, since it's outside Maktaba's control.
- **Reading status** — choose whether starting or finishing a book in the reader **updates your
  reading status automatically**, or shows a notification with the option to apply it (**Ask me
  first**) instead.

## Setting up offline dictionaries

From **Settings → Dictionaries**, add an offline dictionary for any language so you can look up
what a word means right inside the reader — no internet connection required.

Maktaba uses the StarDict dictionary format, the same format used by the free
[GoldenDict](https://github.com/goldendict/goldendict) dictionary application. Many free StarDict
dictionaries are available online, usually packaged as a single `.zip` file containing everything
the dictionary needs.

To add one:

1. Download a StarDict dictionary for the language you want (searching for "StarDict dictionary
   download" or "GoldenDict dictionaries" turns up plenty of free ones).
2. In Maktaba, open **Settings → Dictionaries**, choose the language, and select the downloaded
   `.zip` file.
3. Click **Save** — the dictionary is unpacked and ready to use immediately.

Once a language has a dictionary configured, open any book in that language, select a word, and
right-click it (or long-press on touch screens) to see its definition. See
[Reading Books](./reading) for more.

## Everything stays on your computer

Maktaba doesn't use accounts or the cloud. Every library, book, and setting lives in files on
your own computer, in the folder you chose when you set up that library.

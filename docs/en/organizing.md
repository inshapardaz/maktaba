# Organizing Your Library

Maktaba automatically groups your books by **Author**, and you can further organize them with
**Series**, **Tags**, and **Collections**. You'll find all four in the sidebar on the left,
each showing how many books are in it.

## Authors, Series, and Tags

These are filled in automatically from the information saved inside each book file (or typed in
when you edit a book). You don't need to create them yourself — add an author or a tag to a book
once, and it appears in the sidebar from then on.

- Click any Author, Series, or Tag in the sidebar to see just the books in that group.
- To rename one everywhere at once (fixing a typo in an author's name, for example), click the
  small arrow next to the section title in the sidebar to open the full list, then rename it
  there — every book using it updates automatically.
- Books with no author information appear together under **Unknown Author** at the bottom of the
  Authors list — edit one of them to give it a real author, and it moves out of that group
  automatically.

### Author photos

Open the full Authors list (the arrow next to the section title in the sidebar) to see every
author with a small avatar next to their name. Click an author's avatar to upload a photo for
them from your computer — this is purely cosmetic and has no effect on how books are matched to
that author.

## Renaming a book's title

You don't need to open the full edit screen just to fix a typo in a title. In the **list view**,
click a book's title (or hover the row and click the small pencil icon) to edit it right there —
press **Enter** to save, or **Escape** to cancel.

## Selecting and organizing several books at once

You can act on many books together instead of one at a time:

- **Ctrl+click** (or **Cmd+click** on Mac) a book to add or remove it from the current selection.
- **Shift+click** another book to select every book between it and the last one you clicked.
- Press **Ctrl+A** (or **Cmd+A**) while browsing your library to select every book currently
  shown.
- Click and drag across empty space in the grid or list to draw a selection rectangle over
  several books at once, the same way you'd select multiple icons on your desktop.

With more than one book selected, drag any of them onto an **Author**, **Series**, **Tag**,
**Collection**, or **Periodical** in the sidebar to apply that change to every selected book at
once — for example, tagging a dozen books as "Favorites" in one drag instead of editing each book
individually. Dropping onto an Author, Series, Publisher, or Language group replaces that field
on each book (a book only has one of each); dropping onto a Tag or Collection adds to whatever
tags/collections each book already has.

## Collections

Collections are different: **you** create them, and **you** decide which books go in them —
Maktaba never creates or fills one in automatically. Use Collections for things that don't come
from the book file itself, like "Currently Reading," "Favorites," or "For the Kids."

Open the Collections list from the sidebar to create a new collection, then add books to it from
each book's details.

## Periodicals

Magazines, newspapers, and journals don't fit the usual author/title model — a single periodical
can have dozens or hundreds of **issues**, and what identifies an issue is its volume/issue number
and date, not an author. Maktaba has a separate **Periodicals** section in the sidebar for these.

> Periodicals can be turned off entirely for a library that doesn't need them — see
> [Settings → Libraries](settings.md).

### Creating a periodical

Click the **+** next to Periodicals in the sidebar for a quick add (just a name), or open the full
Periodicals list (the arrow next to the section title) to create one with more detail up front.
Once created, open a periodical to set:

- A **cover image** — click the cover placeholder to upload one from your computer.
- Its **frequency** — Daily, Weekly, Bi-weekly, Monthly, Quarterly, Yearly, or Occasional. This
  also controls how you'll browse its issues (see below).
- **Description**, **language**, **publisher**, **editor**, and **tags** — these describe the
  periodical as a whole, not any one issue.

### Turning a book into an issue

Drag a book from the grid or list straight onto the periodical's row in the sidebar. Maktaba:

- Moves the book's files into that periodical's own folder on disk, organized separately from
  your author folders.
- Clears the fields that no longer apply (author, publisher, language, series, tags, rating,
  description) — a periodical's own metadata covers those instead.
- Lets you set a **volume number**, **issue number**, and **issue date** for it.

You can also assign a periodical from a book's own edit screen, without dragging — pick it from
the **Periodical** field there.

### Editing an issue

Once a book belongs to a periodical, its edit screen looks different: the title, author,
publisher, language, series, tags, rating, and description fields are gone (they're the
periodical's, not the issue's) — what's left is just the periodical it belongs to, its volume and
issue number, and its date. The date field itself changes shape to match the periodical's
frequency: a year picker for a Yearly periodical, year-and-quarter for Quarterly, a month picker
for Monthly, a week picker for Weekly, and an ordinary date picker otherwise.

Everywhere an issue is shown — the grid, the list, its details popup, and the reader's title — it
displays the periodical's name and its date (as year, month, and week number) in place of a title
and author, since that's what actually identifies it.

### Browsing issues by date

Open a periodical to see its issues on the left as a year list, each with how many issues that
year has, with **All** at the top to show everything at once. For a Weekly periodical, clicking a
year expands it into months so you're not scrolling through fifty-two issues at once; for other
frequencies, clicking a year filters straight to it.

## Searching

Press **Ctrl+K** (or **Cmd+K** on Mac) from anywhere in Maktaba to search your whole library
instantly — books, authors, tags, and collections all at once.

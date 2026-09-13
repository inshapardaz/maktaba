# Troubleshooting & FAQ

## A book I added isn't showing up

Open **Settings → Libraries** and click **Resync** on your library. Maktaba will look through
your library folder again and pick up any books that were added outside the app (for example,
copied in manually).

## A book's cover or details look wrong

You can fix a book's title, author, cover, and other details at any time by opening the book and
choosing **Edit**. Your correction is kept — re-scanning your library will never overwrite an
edit you've made.

## Where are my books actually stored?

Everything lives in the library folder you chose, organized as one folder per author, and inside
that one folder per book (containing the book file and its cover). Nothing is hidden away in an
app-specific location — you can always find your books with your computer's regular file browser.

## I have books on another computer — can I use the same library?

Yes. Point Maktaba at the same library folder (for example, on a shared drive or synced folder)
from **Settings → Libraries → Add Library**, and it will read the same books. Maktaba doesn't
sync automatically between two computers open at the same time, though — avoid having the exact
same library open in two places at once.

## My cloud library won't open

Maktaba shows a clear error and, right alongside it, the same library list Settings → Libraries
offers — so you can open a different library straight away rather than being stuck. This usually
means either a network problem or a credential that no longer works with your storage provider
(for example, if the access key was changed or revoked). See
[Cloud libraries](libraries.md#cloud-libraries-s3-compatible-storage) for how to reconnect one.

## Can two computers use the same cloud library at once?

Not at the same time. Like a shared local folder, a cloud library is designed for one device to
have it open at a time — open it on a second device only after closing it on the first, to avoid
one device's changes overwriting the other's.

## Something looks broken — will I lose my books?

No. Maktaba's own internal index (a small database file) can always be safely rebuilt with
**Resync** without touching your actual book files, which are always the "real" copy on disk.

## Still stuck?

Reach out at the project's support channels linked from the Maktaba website — include what you
were doing and, if possible, a screenshot of what you're seeing.

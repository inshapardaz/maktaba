# Cloud Storage

Besides a folder on your own computer, a library can also live in cloud storage — an S3-compatible
bucket, your own Google Drive, or your own OneDrive. Your book files and metadata database are kept
there, so the same library can be reached from more than one computer, with each device keeping a
local copy for fast, offline reading.

## Connecting an S3-compatible library

A library can live in Amazon S3 itself, or a compatible provider such as MinIO, Backblaze B2,
DigitalOcean Spaces, Cloudflare R2, IDrive e2, or a self-hosted server.

From **Settings → Libraries**, click **Connect S3-compatible library…** and fill in:

- **Library name** — the label Maktaba shows you for this library.
- **Bucket** — the name of your storage bucket.
- **Region** — your bucket's region (for Amazon S3). Most other providers accept any value here,
  though a few — Cloudflare R2 in particular — need it left as-is; Maktaba handles that
  automatically.
- **Subfolder within the bucket** *(optional)* — if you want this library to live inside a
  particular folder of the bucket rather than at its root (useful for sharing one bucket between
  several libraries).
- **Server endpoint** *(optional)* — leave this blank for Amazon S3 itself. Set it to point at any
  other S3-compatible provider instead, as a plain address such as `s3.example.com` or
  `play.min.io:9000` — no need to type `https://`.
- **Access key ID** and **Secret access key** — the credentials your storage provider issued you.

Click **Test connection** to check everything works before committing, then **Connect**. Maktaba
saves the credentials encrypted on your own computer (via your operating system's own secure
storage) so you won't need to type them again on this device.

## Connecting a Google Drive library

From **Settings → Libraries**, click **Connect Google Drive…** and fill in:

- **Library name** — the label Maktaba shows you for this library.
- **Folder within Google Drive** *(optional)* — if you want this library to live inside a
  particular folder of your Drive rather than at its root (useful for keeping it separate from
  everything else you keep in Drive). Maktaba creates the folder if it doesn't already exist.

Click **Sign in with Google** — this opens your normal web browser to Google's own sign-in page, so
your Google password is never seen by Maktaba itself. Once you approve access, come back and click
**Connect**. Maktaba saves the sign-in encrypted on your own computer (via your operating system's
own secure storage) so you won't need to sign in again on this device.

## Connecting a OneDrive library

From **Settings → Libraries**, click **Connect OneDrive…** and fill in:

- **Library name** — the label Maktaba shows you for this library.
- **Folder within OneDrive** *(optional)* — if you want this library to live inside a particular
  folder of your OneDrive rather than at its root (useful for keeping it separate from everything
  else you keep in OneDrive). Maktaba creates the folder if it doesn't already exist.

Click **Sign in with Microsoft** — this opens your normal web browser to Microsoft's own sign-in
page, so your Microsoft password is never seen by Maktaba itself. Once you approve access, come
back and click **Connect**. Maktaba saves the sign-in encrypted on your own computer (via your
operating system's own secure storage) so you won't need to sign in again on this device.

## Keeping a cloud library in sync

Maktaba automatically pulls the latest copy of your library's database when you open it, and
pushes your changes back on a regular schedule while it's open. If you want to make sure your
latest changes reach the cloud right away — for example, right before switching to another
computer — open **Settings → Libraries** and click the cloud-upload icon next to the library.
Maktaba will confirm before briefly closing the library to sync it safely, then reopen it
automatically.

A cloud library can only be open on one device at a time. If you try to open one that's already
open elsewhere, Maktaba tells you which device is using it instead of opening it anyway — closing
it there (or switching to a different library) frees it up for this device right away. If that
other device is offline or has crashed, Maktaba lets you back in automatically after a couple of
minutes.

## Moving an existing local library to the cloud

If you already have a library on your own computer and want to move it to cloud storage instead
of starting a new one, open **Settings → Libraries**, make sure the library you want to move is
the active one, and click **Migrate to cloud…**. A wizard walks you through it:

1. **Target** — choose Amazon S3/S3-compatible or Google Drive, then fill in the same fields as
   connecting a cloud library that way (bucket/region/subfolder/server endpoint/credentials, with a
   **Test connection** step for S3; a Google sign-in for Google Drive).
2. **Review** — how many files will be copied. This step is a good moment to make sure you're on
   a connection you're comfortable uploading your whole library over. You can close this window
   at any point after starting — the migration keeps running in the background, and you can check
   back on it later from the same **Migrate to cloud…** button.
3. **Migrate** — a progress bar while your books, covers, and database copy over. Your original
   library is never touched during this step, so if anything goes wrong (a dropped connection, for
   example), nothing is lost — you can simply try again, and files already copied aren't copied a
   second time.
4. **Finish** — once everything's copied and verified, choose whether to keep the original local
   copy as a backup (the default) or delete it, then confirm. Your library switches over to the
   cloud immediately, keeping all your ratings, reading status, and tags exactly as they were.

## If a cloud library won't reconnect

Occasionally Maktaba can't reach a cloud library when starting up — most often because of a
network problem, or because its saved sign-in no longer works (for example, if you changed your S3
provider's access key, or revoked Maktaba's access to your Google or Microsoft account). When this
happens, Maktaba shows the error along with the same library list from Settings, so you can open a
different library immediately rather than being stuck. Once the underlying problem is fixed, switch
back to the cloud library to pick up where you left off.

If the credential itself is the problem, click the key icon next to that library in
**Settings → Libraries**. For an S3-compatible library, re-enter its access key and secret key; for
a Google Drive or OneDrive library, click **Sign in again**. Either way this updates the saved
credential without needing to reconnect the whole library from scratch.

## Deleting books from a cloud library

Deleting a book or periodical from a cloud library removes it from the cloud storage itself, not
just from Maktaba's list — the same as deleting one from a library on your own computer, just
without a Recycle Bin/Trash to recover it from afterward (except on Google Drive, where a deleted
item goes to Drive's own Trash first, the same as deleting it there directly).

## Relocating and resyncing

**Relocate** (telling Maktaba a library's folder moved) is only available for a library stored on
your own computer — a cloud library's location is its bucket/folder configuration instead, set when
you connected it. **Resync** (having Maktaba look through the folder again for books added or
changed outside the app) works for a cloud library too, looking through its remote folder the same
way — useful if a book you know is there isn't showing up yet. See
[Choosing & Switching Libraries](./libraries) for both actions.

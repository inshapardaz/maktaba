# Choosing & Switching Libraries

A **library** is simply a folder on your computer that Maktaba keeps your books in. Most people
only ever need one, but Maktaba supports as many as you like — useful for keeping separate
collections, for example one library per family member, or a separate library for a shared
folder.

## Seeing all your libraries

Open **Settings → Libraries** to see every library you've opened before, with the one currently
in use marked as active.

![Screenshot: Settings → Libraries tab, showing a list of registered libraries with one marked active](../screenshots/lib-settings-tab.png)

## Adding another library

Click **Add Library** and choose a folder, exactly like the very first time you opened Maktaba.
This doesn't affect your existing library at all — it's simply added to your list.

## Switching between libraries

Click **Switch** next to any library in the list to make it the active one. Maktaba changes over
immediately — no restart needed — and everything you see (your book grid, sidebar, and search)
now reflects that library instead.

You can just click the **Open** button to switch the library as active in settings dialog or can use the quick access at the bottom of side bar.

![Screenshot: switching the active library from the Libraries list, with a "Switch" button highlighted](../screenshots/lib-switch.png)

## Cloud libraries (S3-compatible storage)

Besides a folder on your own computer, a library can also live in an S3-compatible cloud storage
bucket — Amazon S3 itself, or a compatible provider such as MinIO, Backblaze B2, DigitalOcean
Spaces, Cloudflare R2, IDrive e2, or a self-hosted server. Your book files and metadata database
are kept in the bucket, so the same library can be reached from more than one computer, with each
device keeping a local copy for fast, offline reading.

### Connecting a cloud library

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

### Keeping a cloud library in sync

Maktaba automatically pulls the latest copy of your library's database when you open it, and
pushes your changes back on a regular schedule while it's open. If you want to make sure your
latest changes reach the cloud right away — for example, right before switching to another
computer — open **Settings → Libraries** and click the cloud-upload icon next to the library.
Maktaba will confirm before briefly closing the library to sync it safely, then reopen it
automatically.

### Moving an existing local library to the cloud

If you already have a library on your own computer and want to move it to cloud storage instead
of starting a new one, open **Settings → Libraries**, make sure the library you want to move is
the active one, and click **Migrate to cloud…**. A wizard walks you through it:

1. **Target** — the same bucket/region/subfolder/server endpoint/credentials fields as connecting
   a cloud library, with a **Test connection** step.
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

### If a cloud library won't reconnect

Occasionally Maktaba can't reach a cloud library when starting up — most often because of a
network problem, or because its saved credentials no longer work (for example, if you changed
your storage provider's access key). When this happens, Maktaba shows the error along with the
same library list from Settings, so you can open a different library immediately rather than
being stuck. Once the underlying problem is fixed, switch back to the cloud library to pick up
where you left off.

## Renaming, moving, or removing a library

From the same list you can:

- **Rename** a library — this only changes the label Maktaba shows you, not the folder itself.
- **Relocate** a library — tell Maktaba the folder has moved (for example, to a new drive)
  without losing anything.
- **Resync** a library — have Maktaba look through the folder again, picking up books that were
  added or changed outside the app.
- **Remove** a library from the list — this only removes it from Maktaba; your books and folder
  on disk are never deleted.

**Relocate** and **Resync** are only available for a library stored on your own computer — a
cloud library's location is its bucket configuration, and it stays in sync automatically instead
(see [Cloud libraries](#cloud-libraries-s3-compatible-storage) above).

> **Tip:** Removing a library from Maktaba's list is always safe for your files. To actually
> delete books, delete them from within Maktaba (or from the folder itself) — removing the
> *library* just stops Maktaba from tracking that folder.

import { useState } from "react";
import { openLibrary } from "../api";

interface LibraryPickerProps {
  onOpened: (path: string) => void;
}

export function LibraryPicker({ onOpened }: LibraryPickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChoose = async () => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const info = await openLibrary(folder);
      onOpened(info.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="library-picker">
      <h1>مکتبہ — Maktaba</h1>
      <p>Choose a folder to use as your library, or create a new one.</p>
      <button type="button" onClick={handleChoose} disabled={busy}>
        {busy ? "Opening…" : "Choose Library Folder"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

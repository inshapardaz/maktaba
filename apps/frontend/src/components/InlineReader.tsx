import { useEffect } from "react";
import { ReaderOverlay } from "./ReaderOverlay";

interface InlineReaderProps {
  bookId: string;
  format: "Epub" | "Pdf";
  onClose: () => void;
}

// The "render in the main window" alternative to main.ts's openReaderWindow (a separate Electron
// BrowserWindow) - reuses the same ReaderOverlay the pop-out window loads. ReaderOverlay already
// renders pos="fixed" covering the whole viewport at zIndex 2000 (so the pop-out window's content
// fills it edge to edge), which conveniently means mounting it here also takes over the entire app
// window - title bar and sidebar included - with no extra layout work. The close affordance is
// qari's own reader-header close button (showCloseButton/onClose - see ReaderOverlay.tsx), not a
// custom one layered on top. Closing it is just unmounting this component: nothing about
// mainView/groupFilter/etc. ever changed, so whatever was showing underneath reappears exactly as
// it was.
export function InlineReader({ bookId, format, onClose }: InlineReaderProps) {
  // Escape closes the reader, same as its own close button - only wired up here (not
  // ReaderOverlay itself), since the pop-out window has no "previous screen" to return to and
  // relies on native window chrome (Alt+F4/the OS close button) instead. If qari has its own
  // Escape handling for a transient overlay (e.g. dismissing a note popover), that keydown stops
  // propagating before it reaches this window-level listener, so this only fires when nothing
  // inside the reader already claimed the key.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return <ReaderOverlay bookId={bookId} format={format} onClose={onClose} />;
}

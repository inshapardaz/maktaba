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
  return <ReaderOverlay bookId={bookId} format={format} onClose={onClose} />;
}

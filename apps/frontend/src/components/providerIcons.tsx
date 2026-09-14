import { IconCloud, type Icon } from "../icons";

// A plain bold "G" glyph rather than lucide-react's generic HardDrive icon - lucide carries no
// actual Google logo (no icon library here does; trademarked marks aren't something an open icon
// set ships), but a recognizable letterform reads far more clearly as "this is Google Drive" at a
// glance than a generic drive icon would, without reproducing Google's own mark. Neutral color
// (inherits currentColor, same as every other icon here) rather than Google's brand colors,
// consistent with this app never styling provider badges to look like an official Google asset.
function GoogleDriveIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: typeof size === "number" ? size * 0.8 : size,
        fontWeight: 800,
        lineHeight: 1,
        fontFamily: "var(--mantine-font-family-headings, inherit)",
        flexShrink: 0,
        ...style,
      }}
    >
      G
    </span>
  );
}

// Shared between LibrarySwitcher.tsx's sidebar dropdown and LibrariesSettings.tsx's per-library
// badges/connect buttons, so a library's provider reads as the same icon everywhere rather than
// each spot picking its own. "local" has no entry: every consumer only looks this up for a
// non-local providerType, matching how a provider badge/icon never renders for a local library
// elsewhere in this app.
export const PROVIDER_ICONS: Record<string, Icon> = {
  s3: IconCloud,
  onedrive: IconCloud,
  googledrive: GoogleDriveIcon as unknown as Icon,
  nawishta: IconCloud,
};

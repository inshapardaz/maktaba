import { Box, Stack, Text } from "@mantine/core";

interface SpineCoverProps {
  /** Any stable identifier for the book — picks a deterministic palette color. */
  id: string;
  title: string;
  author?: string;
  width: number | string;
  height: number | string;
  titleSize?: number;
  metaSize?: number;
  padding?: number;
}

// Mirrors design/Codex Library.dc.html's SPINES palette (accent/neutral tones
// cycled by book id) — used as the book-cover placeholder when no real cover
// art was extracted from the file.
const SPINE_PALETTE = [
  "var(--mantine-primary-color-7)",
  "var(--mantine-color-gray-8)",
  "var(--mantine-primary-color-6)",
  "var(--mantine-color-gray-7)",
  "var(--mantine-primary-color-8)",
  "var(--mantine-color-gray-9)",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function spineColorFor(id: string): string {
  return SPINE_PALETTE[hashString(id) % SPINE_PALETTE.length];
}

export function SpineCover({ id, title, author, width, height, titleSize = 18, metaSize = 10.5, padding = 12 }: SpineCoverProps) {
  return (
    <Box
      w={width}
      h={height}
      p={padding}
      style={{
        background: spineColorFor(id),
        borderRadius: "var(--mantine-radius-sm)",
        border: "1px solid var(--mantine-color-default-border)",
        boxShadow: "var(--mantine-shadow-sm)",
        overflow: "hidden",
      }}
    >
      <Stack justify="space-between" h="100%" gap={0}>
        <span />
        <Text
          ff="var(--mantine-font-family-headings)"
          fz={titleSize}
          lh={1.18}
          c="white"
          lineClamp={5}
        >
          {title}
        </Text>
        <Text fz={metaSize} c="white" opacity={0.85} truncate="end">
          {author}
        </Text>
      </Stack>
    </Box>
  );
}

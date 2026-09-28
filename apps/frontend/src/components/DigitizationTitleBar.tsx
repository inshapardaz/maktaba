import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Badge, Box, Button, Group, Text } from "@mantine/core";
import { publishDigitizedBook, type PublishFormat } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconBook2, IconFileText, IconUpload } from "../icons";
import { MenuButton, TITLEBAR_HEIGHT, useTitleBarOverlayPadding, WindowControls } from "./TitleBar";

const isMac = window.maktaba.platform === "darwin";

const PUBLISH_FORMATS: { format: PublishFormat; labelKey: "digitize.publishEpub" | "digitize.publishMarkdown" | "digitize.publishPdf" }[] = [
  { format: "Epub", labelKey: "digitize.publishEpub" },
  { format: "Markdown", labelKey: "digitize.publishMarkdown" },
  { format: "Pdf", labelKey: "digitize.publishPdf" },
];

// Matches the main window's own frameless chrome (see main.ts's openDigitizationWindow) instead of
// native OS chrome, so a digitization window looks/behaves consistently with the rest of the app -
// custom minimize/maximize/close (WindowControls), the same menu button honoring Settings' "show
// menu" toggle (MenuButton), reused as-is from TitleBar.tsx. Unlike the main title bar, the middle
// carries this book's own title/author/chapter+page counts, and publish moved here from the old
// standalone PublishPanel so it's reachable regardless of which page/chapter is in view.
export function DigitizationTitleBar({
  bookId, bookTitle, authors, chapterCount, pageCount, showCounts,
}: {
  bookId: string;
  bookTitle: string | undefined;
  authors: string[] | undefined;
  chapterCount: number;
  pageCount: number;
  showCounts: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { paddingLeft, paddingRight } = useTitleBarOverlayPadding();

  const publishMutation = useMutation({
    mutationFn: (format: PublishFormat) => publishDigitizedBook(bookId, format),
    onSuccess: (result) => {
      notifications.show({ color: "green", message: t("digitize.publishSucceeded", { format: result.format }) });
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  return (
    <Box
      className="maktaba-titlebar-drag"
      h={TITLEBAR_HEIGHT}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        borderBottom: "1px solid var(--mantine-color-default-border)",
        boxSizing: "border-box",
        overflow: "hidden",
        paddingLeft,
        paddingRight,
      }}
    >
      <Group gap={6} wrap="nowrap" ms={8} style={{ flexShrink: 0 }}>
        <img src="icon.png" alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} />
        <Text ff="var(--mantine-font-family-headings)" fw={600} fz={16} style={{ flexShrink: 0 }}>
          {t("digitize.windowTitle")}
        </Text>
      </Group>
      <MenuButton />

      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        {bookTitle && (
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} fz={14} truncate style={{ maxWidth: 320 }}>
              {bookTitle}
            </Text>
            {authors && authors.length > 0 && (
              <Text fz={12} c="dimmed" truncate style={{ maxWidth: 200 }}>
                {authors.join(", ")}
              </Text>
            )}
            {showCounts && (
              <Group gap={4} wrap="nowrap">
                <Badge size="xs" variant="light">{t("digitize.chapterCount", { count: chapterCount })}</Badge>
                <Badge size="xs" variant="light">{t("digitize.pageCount", { count: pageCount })}</Badge>
              </Group>
            )}
          </Group>
        )}
      </Group>

      {showCounts && (
        <Group gap={4} wrap="nowrap" className="maktaba-titlebar-no-drag" style={{ flexShrink: 0 }}>
          {PUBLISH_FORMATS.map(({ format, labelKey }) => (
            <Button
              key={format}
              size="xs"
              variant="light"
              leftSection={format === "Epub" ? <IconBook2 size={14} /> : format === "Pdf" ? <IconFileText size={14} /> : <IconUpload size={14} />}
              loading={publishMutation.isPending && publishMutation.variables === format}
              onClick={() => publishMutation.mutate(format)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </Group>
      )}

      {!isMac && <WindowControls />}
    </Box>
  );
}

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Alert, Box, Button, Center, Loader, Progress, Stack, Text } from "@mantine/core";
import { getBook, getConversionProgress, getDigitizationState, setGoogleVisionApiKey, startDigitizationConversion } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconAlertCircle, IconScanLine } from "../icons";
import { DigitizationChapterSidebar } from "./DigitizationChapterSidebar";
import { DigitizationPageManager } from "./DigitizationPageManager";
import { DigitizationTitleBar } from "./DigitizationTitleBar";
import { TITLEBAR_HEIGHT } from "./TitleBar";

const CONTENT_HEIGHT = `calc(100vh - ${TITLEBAR_HEIGHT}px)`;

// Content for the digitization workflow's own top-level window (apps/desktop/src/main.ts's
// openDigitizationWindow, opened from DigitizeConfirmDialog.tsx once digitization.json exists).
// Frameless, with its own DigitizationTitleBar reusing the main window's custom chrome
// (WindowControls/MenuButton) rather than native OS chrome, so a digitization window looks and
// behaves consistently with the rest of the app - see DigitizationTitleBar's own doc comment.
export function DigitizationWindow({ bookId }: { bookId: string }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = "Maktaba";
  }, []);

  // Phase 6 (OCR) - the backend's IOcrApiKeyCache is in-memory-only and starts empty every process
  // restart; this window is where the API key actually gets used (Run OCR), so it re-pushes an
  // already-saved key here rather than relying on the user having visited Settings this session -
  // see OcrSettings.tsx's own copy of this same reconnect for the Settings-side case.
  useEffect(() => {
    void window.maktaba.getCloudCredential("google-vision-api-key").then((saved) => {
      if (saved) void setGoogleVisionApiKey(saved);
    });
  }, []);

  const bookQuery = useQuery({ queryKey: ["book", bookId], queryFn: () => getBook(bookId) });
  const stateQuery = useQuery({ queryKey: ["digitizationState", bookId], queryFn: () => getDigitizationState(bookId) });

  // Polls only while a conversion is actually running (or might just have been kicked off) -
  // mirrors the rescan/migration progress polling pattern (LibrariesSettings.tsx's
  // refetchInterval usage), scoped down to 1s since a user is actively watching this window.
  const isConverting = stateQuery.data !== undefined && stateQuery.data !== null && stateQuery.data.pages.length === 0;
  const progressQuery = useQuery({
    queryKey: ["digitizationConvertProgress"],
    queryFn: getConversionProgress,
    refetchInterval: (query) => (query.state.data?.isRunning ? 1000 : false),
    enabled: isConverting,
  });

  useEffect(() => {
    if (progressQuery.data && !progressQuery.data.isRunning) {
      if (progressQuery.data.error) {
        notifications.show({ color: "red", message: progressQuery.data.error });
      }
      void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });
    }
  }, [progressQuery.data, queryClient, bookId]);

  const convertMutation = useMutation({
    mutationFn: () => startDigitizationConversion(bookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["digitizationConvertProgress"] });
      void progressQuery.refetch();
    },
    onError: (err) => {
      notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) });
    },
  });

  const running = progressQuery.data?.isRunning ?? false;
  const hasPages = (stateQuery.data?.pages.length ?? 0) > 0;

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <DigitizationTitleBar
        bookId={bookId}
        bookTitle={bookQuery.data?.title}
        authors={bookQuery.data?.authors}
        chapterCount={stateQuery.data?.chapters.length ?? 0}
        pageCount={stateQuery.data?.pages.length ?? 0}
        showCounts={hasPages}
      />

      <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {(bookQuery.isLoading || stateQuery.isLoading) && (
          <Center h={CONTENT_HEIGHT}>
            <Loader />
          </Center>
        )}

        {!bookQuery.isLoading && !stateQuery.isLoading && !stateQuery.data && (
          <Center h={CONTENT_HEIGHT} p="xl">
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {t("digitize.notStarted")}
            </Alert>
          </Center>
        )}

        {stateQuery.data && !hasPages && !running && (
          // "When the window loads, show a centered message to pick the source file and confirm
          // digitizing it" - the source PDF was already picked when the user clicked "Digitize…"
          // on the book (see DigitizeConfirmDialog.tsx), so this is that confirmation step: the
          // one action available before any pages exist, centered rather than tucked in a corner.
          <Center h={CONTENT_HEIGHT} p="xl">
            <Stack gap="sm" align="center" maw={420}>
              <Text size="sm" c="dimmed" ta="center">
                {t("digitize.convertExplain")}
              </Text>
              <Button
                leftSection={<IconScanLine size={16} />}
                loading={convertMutation.isPending}
                onClick={() => convertMutation.mutate()}
              >
                {t("digitize.convertStart")}
              </Button>
            </Stack>
          </Center>
        )}

        {running && (
          <Center h={CONTENT_HEIGHT} p="xl">
            <Stack gap="xs" maw={420} w="100%">
              <Text size="sm" ta="center">
                {t("digitize.convertProgress", {
                  processed: progressQuery.data?.processed ?? 0,
                  total: progressQuery.data?.total ?? 0,
                })}
              </Text>
              <Progress
                value={progressQuery.data?.total ? (progressQuery.data.processed / progressQuery.data.total) * 100 : 0}
                animated
              />
            </Stack>
          </Center>
        )}

        {stateQuery.data && hasPages && !running && (
          <Box style={{ display: "flex", alignItems: "flex-start", height: "100%" }}>
            <Box p="sm" style={{ flexShrink: 0, height: "100%", overflow: "auto" }}>
              <DigitizationChapterSidebar bookId={bookId} state={stateQuery.data} />
            </Box>
            <Box p="sm" style={{ flex: 1, minWidth: 0, height: "100%", overflow: "auto" }}>
              <DigitizationPageManager bookId={bookId} state={stateQuery.data} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

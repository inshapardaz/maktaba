import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Alert, Box, Button, Center, Group, Loader, Progress, Stack, Text, Title } from "@mantine/core";
import { getBook, getConversionProgress, getDigitizationState, startDigitizationConversion } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconAlertCircle, IconScanLine } from "../icons";
import { DigitizationChapterSidebar } from "./DigitizationChapterSidebar";
import { DigitizationPageManager } from "./DigitizationPageManager";

// Content for the digitization workflow's own top-level window (apps/desktop/src/main.ts's
// openDigitizationWindow, opened from DigitizeConfirmDialog.tsx once digitization.json exists).
// Phase 1 only owns "convert the source PDF into pages/, show progress" - the actual page list/
// grid/editing UI is Phase 2+'s own job; this window's content will grow into that as those land,
// the same way ReaderOverlay.tsx is the one thing rendered inside a reader window.
export function DigitizationWindow({ bookId }: { bookId: string }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = "Maktaba";
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

  if (bookQuery.isLoading || stateQuery.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!stateQuery.data) {
    return (
      <Center h="100vh" p="xl">
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {t("digitize.notStarted")}
        </Alert>
      </Center>
    );
  }

  const running = progressQuery.data?.isRunning ?? false;
  const hasPages = stateQuery.data.pages.length > 0;

  return (
    <Box p="xl" style={{ maxWidth: hasPages ? 1200 : 640, margin: "0 auto" }}>
      <Stack gap="md">
        <Title order={3}>{bookQuery.data?.title ?? t("bookDetail.digitizeTitle")}</Title>

        {!hasPages && !running && (
          <Stack gap="sm" align="flex-start">
            <Text size="sm" c="dimmed">
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
        )}

        {running && (
          <Stack gap="xs">
            <Text size="sm">
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
        )}

        {hasPages && !running && (
          <>
            <Text size="sm" c="dimmed">
              {t("digitize.pagesReady", { count: stateQuery.data.pages.length })}
            </Text>
            <Group align="flex-start" wrap="nowrap">
              <DigitizationChapterSidebar bookId={bookId} state={stateQuery.data} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <DigitizationPageManager bookId={bookId} state={stateQuery.data} />
              </div>
            </Group>
          </>
        )}
      </Stack>
    </Box>
  );
}

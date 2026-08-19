import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Button, Center, Group, Image, Progress, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconCircleCheck, IconPlayerPlay } from "@tabler/icons-react";
import { coverUrl, listContinueReading, updateBookStatus, type ContinueReadingBook } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { useReaderLauncher } from "../ReaderLauncherContext";
import { invalidateLibraryQueries } from "../queries";
import { SpineCover } from "./SpineCover";

function SectionLabel({ children }: { children: string }) {
  return (
    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: "0.1em" }}>
      {children}
    </Text>
  );
}

interface HomeViewProps {
  onSelectBook: (id: string) => void;
}

// The Home view: a "continue reading" hero for the most recently read book, plus a compact list
// of every other book currently in progress. Both come from one ordered feed (see
// listContinueReading / backend BookEndpoints.cs's /continue-reading) rather than two separate
// requests, so there's a single loading/empty state to handle.
export function HomeView({ onSelectBook }: HomeViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const launchReader = useReaderLauncher();
  const continueReadingQuery = useQuery({ queryKey: ["continueReading"], queryFn: () => listContinueReading(20) });

  const resumeBook = (book: ContinueReadingBook) => {
    launchReader({
      bookId: book.id,
      format: book.format,
      title: book.title,
      absolutePath: book.absolutePath,
      readingStatus: book.readingStatus,
    });
  };

  // Manual escape hatch alongside the reader's own auto-complete-at-100% (see backend
  // ReaderDataEndpoints.cs's /progress handler) - for a book the reader considers "done enough"
  // without ever reporting a clean 100% (e.g. skipping the last page, or a format where percentage
  // tracking is approximate).
  const markFinishedMutation = useMutation({
    mutationFn: (bookId: string) => updateBookStatus(bookId, "Finished"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["continueReading"] });
      invalidateLibraryQueries(queryClient);
    },
  });

  const items = continueReadingQuery.data ?? [];
  const [lastRead, ...rest] = items;
  const inProgress = rest.filter((book) => book.readingStatus === "Reading");

  if (!continueReadingQuery.isLoading && !lastRead) {
    return (
      <Center style={{ flex: 1 }} p="xl">
        <Text c="dimmed" ta="center">
          {t("home.empty")}
        </Text>
      </Center>
    );
  }

  return (
    <Box style={{ flex: 1, overflow: "auto" }} p="xl">
      <Stack gap="xl" maw={860} mx="auto">
        {lastRead && (
          <Box>
            <SectionLabel>{t("home.continueReading")}</SectionLabel>
            <Group
              align="stretch"
              gap="lg"
              p="lg"
              wrap="nowrap"
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-md)",
              }}
            >
              <UnstyledButton onClick={() => onSelectBook(lastRead.id)} style={{ flexShrink: 0 }}>
                {lastRead.hasCover ? (
                  <Image
                    src={coverUrl(lastRead.id)}
                    alt=""
                    w={120}
                    h={180}
                    fit="cover"
                    radius="sm"
                    style={{ border: "1px solid var(--mantine-color-default-border)", boxShadow: "var(--mantine-shadow-sm)" }}
                  />
                ) : (
                  <SpineCover
                    id={lastRead.id}
                    title={lastRead.title}
                    author={lastRead.authors.join(", ") || t("common.unknownAuthor")}
                    width={120}
                    height={180}
                  />
                )}
              </UnstyledButton>

              <Stack gap={6} justify="center" style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700} fz="lg" lineClamp={2}>
                  {lastRead.title}
                </Text>
                <Text c="dimmed" size="sm" truncate="end">
                  {lastRead.authors.join(", ") || t("common.unknownAuthor")}
                </Text>
                <Group gap="xs" align="center" mt={4}>
                  <Progress value={lastRead.percentage} size="sm" style={{ flex: 1 }} />
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {Math.round(lastRead.percentage)}%
                  </Text>
                </Group>
                <Group gap="xs" mt="xs">
                  <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => resumeBook(lastRead)}>
                    {t("home.resume")}
                  </Button>
                  {lastRead.readingStatus === "Reading" && (
                    <Button
                      variant="light"
                      leftSection={<IconCircleCheck size={16} />}
                      onClick={() => markFinishedMutation.mutate(lastRead.id)}
                      loading={markFinishedMutation.isPending && markFinishedMutation.variables === lastRead.id}
                    >
                      {t("home.markAsFinished")}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Group>
          </Box>
        )}

        {inProgress.length > 0 && (
          <Box>
            <SectionLabel>{t("home.currentlyReading")}</SectionLabel>
            <Stack gap="xs">
              {inProgress.map((book) => (
                <Group
                  key={book.id}
                  justify="space-between"
                  wrap="nowrap"
                  p="xs"
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-sm)",
                  }}
                >
                  <UnstyledButton onClick={() => onSelectBook(book.id)} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="sm" wrap="nowrap">
                      {book.hasCover ? (
                        <Image
                          src={coverUrl(book.id)}
                          alt=""
                          w={36}
                          h={54}
                          fit="cover"
                          radius={4}
                          style={{ flexShrink: 0, border: "1px solid var(--mantine-color-default-border)" }}
                        />
                      ) : (
                        <SpineCover id={book.id} title={book.title} width={36} height={54} titleSize={7} padding={4} />
                      )}
                      <Stack gap={2} style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm" truncate="end">
                          {book.title}
                        </Text>
                        <Text size="xs" c="dimmed" truncate="end">
                          {book.authors.join(", ") || t("common.unknownAuthor")}
                        </Text>
                      </Stack>
                    </Group>
                  </UnstyledButton>

                  <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Progress value={book.percentage} size="sm" w={80} />
                    <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} onClick={() => resumeBook(book)}>
                      {t("home.resume")}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="gray"
                      leftSection={<IconCircleCheck size={14} />}
                      onClick={() => markFinishedMutation.mutate(book.id)}
                      loading={markFinishedMutation.isPending && markFinishedMutation.variables === book.id}
                    >
                      {t("home.markAsFinished")}
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

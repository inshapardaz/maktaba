import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Badge, Box, Button, Center, Group, Image, Progress, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBooks, IconCircleCheck, IconPlayerPlay, IconUser } from "../icons";
import {
  authorImageUrl,
  coverUrl,
  listContinueReading,
  listRecentlyAdded,
  updateBookStatus,
  type AuthorRef,
  type ContinueReadingBook,
} from "../api";
import { setBookDragData } from "../bookDrag";
import { useLanguage } from "../i18n/LanguageContext";
import { getStoredShowIssuesInGrid } from "../periodicalSettings";
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

// Just the first author's photo (most books have one anyway) alongside the full joined name text -
// avoids a cramped row of overlapping avatars when a book has several authors.
function AuthorAvatar({ authorRefs, size }: { authorRefs: AuthorRef[]; size: number }) {
  const first = authorRefs[0];
  return (
    <Avatar src={first?.hasImage ? authorImageUrl(first.id) : null} size={size} radius="xl" style={{ flexShrink: 0 }}>
      <IconUser size={Math.round(size * 0.55)} />
    </Avatar>
  );
}

interface HomeViewProps {
  onSelectBook: (id: string) => void;
}

// The Home view: a "continue reading" hero for the most recently read book, a compact list of
// every other book currently in progress, and a "recently added" shelf. The first two come from
// one ordered feed (see listContinueReading / backend BookEndpoints.cs's /continue-reading)
// rather than two separate requests; the shelf is a second, independent feed (listRecentlyAdded /
// /recently-added) since a freshly imported library has nothing in the first feed at all.
export function HomeView({ onSelectBook }: HomeViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const launchReader = useReaderLauncher();
  const continueReadingQuery = useQuery({
    queryKey: ["continueReading"],
    queryFn: () => listContinueReading(20, getStoredShowIssuesInGrid()),
  });
  // Independent of continueReadingQuery - a freshly imported library has nothing in progress yet,
  // but there's still plenty to show here (see backend BookEndpoints.cs's /recently-added).
  const recentlyAddedQuery = useQuery({
    queryKey: ["recentlyAdded"],
    queryFn: () => listRecentlyAdded(20, getStoredShowIssuesInGrid()),
  });

  const resumeBook = (book: ContinueReadingBook) => {
    launchReader({
      bookId: book.id,
      format: book.format,
      title: book.title,
      absolutePath: book.absolutePath,
      readingStatus: book.readingStatus,
    });
  };

  // Manual escape hatch alongside the reader's own auto-tag-at-100% (see ReaderOverlay.tsx's
  // maybeAutoTagStatus / Settings -> Reading's "Reading status" preference) - for a book the reader
  // considers "done enough" without ever reporting a clean 100% (e.g. skipping the last page, or a
  // format where percentage tracking is approximate), or when the user has that preference set to
  // "ask" and dismissed the notification instead of applying it.
  const markFinishedMutation = useMutation({
    mutationFn: (bookId: string) => updateBookStatus(bookId, "Finished"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["continueReading"] });
      invalidateLibraryQueries(queryClient);
    },
  });

  // The /continue-reading feed is ordered purely by ReadingProgress.UpdatedAt, with no status
  // filter server-side (see BookEndpoints.cs) - a book marked Finished still touches its progress
  // row, so without this filter it could outrank actually-in-progress books and show as the
  // "Continue Reading" hero (issue #17) instead of being excluded from this feed entirely.
  const items = (continueReadingQuery.data ?? []).filter((book) => book.readingStatus === "Reading");
  const [lastRead, ...rest] = items;
  const inProgress = rest;
  const recentBooks = recentlyAddedQuery.data ?? [];

  // Only reachable when the whole library is empty (no books at all) - a library with books but
  // none in progress still has the Recently Added shelf below to show.
  const stillLoading = continueReadingQuery.isLoading || recentlyAddedQuery.isLoading;
  if (!stillLoading && !lastRead && recentBooks.length === 0) {
    return (
      <Center style={{ flex: 1 }} p="xl">
        <Text c="dimmed" ta="center">
          {t("app.emptyLibrary")}
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
              gap="xl"
              p="xl"
              wrap="nowrap"
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-lg)",
                // "to inline-end" (rather than a fixed angle like 135deg) follows the reading
                // direction on its own - it flips to run right-to-left under the Urdu/RTL UI
                // instead of always fading toward the physical right edge.
                background: "linear-gradient(to inline-end, #ebddc5 0%, var(--mantine-color-body) 55%)",
              }}
            >
              <UnstyledButton
                draggable
                onDragStart={(event) => setBookDragData(event, [lastRead.id])}
                onClick={() => onSelectBook(lastRead.id)}
                style={{ flexShrink: 0 }}
              >
                {lastRead.hasCover ? (
                  <Image
                    src={coverUrl(lastRead.id)}
                    alt=""
                    w={150}
                    h={225}
                    fit="cover"
                    radius="md"
                    style={{ border: "1px solid var(--mantine-color-default-border)", boxShadow: "var(--mantine-shadow-md)" }}
                  />
                ) : (
                  <SpineCover
                    id={lastRead.id}
                    title={lastRead.title}
                    author={lastRead.authors.join(", ") || t("common.unknownAuthor")}
                    width={150}
                    height={225}
                  />
                )}
              </UnstyledButton>

              <Stack gap={8} justify="center" style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700} fz={22} lineClamp={2}>
                  {lastRead.title}
                </Text>
                <Group gap={6} wrap="nowrap">
                  {lastRead.authorRefs.length > 0 && <AuthorAvatar authorRefs={lastRead.authorRefs} size={24} />}
                  <Text c="dimmed" size="sm" truncate="end">
                    {lastRead.authors.join(", ") || t("common.unknownAuthor")}
                  </Text>
                </Group>
                <Group gap="xs" align="center" mt={8}>
                  <Progress value={lastRead.percentage} size="md" radius="xl" style={{ flex: 1 }} />
                  <Badge size="md" variant="light">
                    {Math.round(lastRead.percentage)}%
                  </Badge>
                </Group>
                <Group gap="xs" mt="sm">
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

        {/* Shown whenever nothing is currently "Reading" - a library with books but nothing in
            progress would otherwise jump straight from nothing to the Recently Added list, which
            reads as broken rather than intentional on a first run or right after finishing a book. */}
        {!lastRead && (
          <Box
            p="xl"
            style={{
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: "var(--mantine-radius-lg)",
              background:
                "linear-gradient(135deg, var(--mantine-primary-color-light) 0%, var(--mantine-color-body) 55%)",
              textAlign: "center",
            }}
          >
            <Stack gap={4} align="center">
              <IconBooks size={32} style={{ opacity: 0.7 }} />
              <Text fw={700} fz={20}>
                {t("home.welcomeTitle")}
              </Text>
              <Text c="dimmed" size="sm">
                {t("home.welcomeSubtitle")}
              </Text>
            </Stack>
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
                  <UnstyledButton
                    draggable
                    onDragStart={(event) => setBookDragData(event, [book.id])}
                    onClick={() => onSelectBook(book.id)}
                    style={{ flex: 1, minWidth: 0 }}
                  >
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
                        <Group gap={4} wrap="nowrap">
                          {book.authorRefs.length > 0 && <AuthorAvatar authorRefs={book.authorRefs} size={16} />}
                          <Text size="xs" c="dimmed" truncate="end">
                            {book.authors.join(", ") || t("common.unknownAuthor")}
                          </Text>
                        </Group>
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

        {recentBooks.length > 0 && (
          <Box>
            <SectionLabel>{t("home.recentlyAdded")}</SectionLabel>
            <Stack gap="xs">
              {recentBooks.map((book) => (
                <UnstyledButton
                  key={book.id}
                  draggable
                  onDragStart={(event) => setBookDragData(event, [book.id])}
                  onClick={() => onSelectBook(book.id)}
                  style={{
                    display: "block",
                    padding: "var(--mantine-spacing-xs)",
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-sm)",
                  }}
                >
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
                      <Group gap={4} wrap="nowrap">
                        {book.authorRefs.length > 0 && <AuthorAvatar authorRefs={book.authorRefs} size={16} />}
                        <Text size="xs" c="dimmed" truncate="end">
                          {book.authors.join(", ") || t("common.unknownAuthor")}
                        </Text>
                      </Group>
                    </Stack>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

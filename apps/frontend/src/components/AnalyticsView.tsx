import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Card, Center, Group, Loader, Progress, SimpleGrid, Table, Text } from "@mantine/core";
import { getAnalyticsSummary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../readingTime";
import { READING_STATUS_COLOR, READING_STATUS_LABEL_KEY } from "../readingStatus";
import { BrowseViewHeader } from "./BrowseViewHeader";

interface AnalyticsViewProps {
  onBack: () => void;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
        {label}
      </Text>
      <Text fz={28} fw={700} mt={4}>
        {value}
      </Text>
      {sub && (
        <Text size="sm" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
    </Card>
  );
}

export function AnalyticsView({ onBack }: AnalyticsViewProps) {
  const { t } = useLanguage();
  const summaryQuery = useQuery({ queryKey: ["analytics"], queryFn: getAnalyticsSummary });
  const summary = summaryQuery.data;

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("analytics.title")} onBack={onBack} />

      <Box p="xl" style={{ flex: 1, overflow: "auto" }}>
        {summaryQuery.isLoading && (
          <Center py="xl">
            <Loader />
          </Center>
        )}

        {summary && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="xl">
              <StatCard label={t("analytics.totalRead")} value={formatDuration(summary.totalSecondsRead, t)} />
              <StatCard
                label={t("analytics.reading")}
                value={String(summary.readingCount)}
                sub={t("analytics.readingSub", {
                  spent: formatDuration(summary.readingSecondsSpent, t),
                  remaining: formatDuration(summary.readingSecondsRemaining, t),
                })}
              />
              <StatCard
                label={t("analytics.unread")}
                value={String(summary.unreadCount)}
                sub={
                  summary.unreadExpectedSecondsTotal > 0
                    ? t("analytics.unreadSub", { duration: formatDuration(summary.unreadExpectedSecondsTotal, t) })
                    : undefined
                }
              />
              <StatCard label={t("analytics.finished")} value={String(summary.finishedCount)} />
            </SimpleGrid>

            <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: "0.1em" }}>
              {t("analytics.perBook")}
            </Text>

            {summary.books.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("analytics.empty")}
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={640}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("bookList.title")}</Table.Th>
                      <Table.Th>{t("bookDetail.readingStatus")}</Table.Th>
                      <Table.Th>{t("analytics.progress")}</Table.Th>
                      <Table.Th>{t("analytics.timeRead")}</Table.Th>
                      <Table.Th>{t("analytics.remaining")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.books.map((book) => (
                      <Table.Tr key={book.id}>
                        <Table.Td>{book.title}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={READING_STATUS_COLOR[book.readingStatus]}>
                            {t(READING_STATUS_LABEL_KEY[book.readingStatus])}
                          </Badge>
                        </Table.Td>
                        <Table.Td w={140}>
                          <Group gap={6} wrap="nowrap">
                            <Progress value={book.percentage} size="sm" style={{ flex: 1 }} />
                            <Text size="xs" c="dimmed">
                              {Math.round(book.percentage)}%
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>{formatDuration(book.secondsRead, t)}</Table.Td>
                        <Table.Td>{book.remainingSeconds != null ? formatDuration(book.remainingSeconds, t) : "—"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

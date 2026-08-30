import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Box,
  Card,
  Center,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { getAnalyticsSummary, getReadingTimeReport } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../readingTime";
import { formatDayOfWeek, formatHour, formatMonth, formatShortDate } from "../readingTimeReport";
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

interface Bar {
  key: string;
  label: string;
  tooltipLabel: string;
  seconds: number;
  highlighted?: boolean;
}

// Single-series magnitude bars: one hue (the app's accent color), height encodes seconds, the
// tallest/relevant bar highlighted with a darker shade rather than a second color - there's only
// one series here, so no legend is needed.
function BarChart({ bars, height = 120 }: { bars: Bar[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.seconds));
  return (
    <Group gap={3} align="flex-end" wrap="nowrap" style={{ height, overflowX: "auto" }}>
      {bars.map((bar) => (
        <Tooltip key={bar.key} label={bar.tooltipLabel} withArrow openDelay={150}>
          <Stack gap={4} align="center" style={{ flex: "1 0 auto", minWidth: 8, height: "100%" }} justify="flex-end">
            <Box
              style={{
                width: "100%",
                minHeight: 2,
                height: `${Math.max(2, (bar.seconds / max) * 100)}%`,
                borderRadius: 3,
                background: bar.highlighted ? "var(--mantine-primary-color-7)" : "var(--mantine-primary-color-4)",
              }}
            />
          </Stack>
        </Tooltip>
      ))}
    </Group>
  );
}

type ReadingTimePeriod = "daily" | "weekly" | "monthly";

export function AnalyticsView({ onBack }: AnalyticsViewProps) {
  const { t, language } = useLanguage();
  const summaryQuery = useQuery({ queryKey: ["analytics"], queryFn: getAnalyticsSummary });
  const readingTimeQuery = useQuery({ queryKey: ["analytics", "reading-time"], queryFn: getReadingTimeReport });
  const summary = summaryQuery.data;
  const readingTime = readingTimeQuery.data;
  const [period, setPeriod] = useState<ReadingTimePeriod>("daily");

  const periodBars: Bar[] | undefined =
    readingTime &&
    (period === "daily"
      ? readingTime.daily.map((p) => ({
          key: p.date,
          label: formatShortDate(p.date, language),
          tooltipLabel: `${formatShortDate(p.date, language)}: ${formatDuration(p.seconds, t)}`,
          seconds: p.seconds,
        }))
      : period === "weekly"
        ? readingTime.weekly.map((w) => ({
            key: w.weekStart,
            label: formatShortDate(w.weekStart, language),
            tooltipLabel: t("analytics.weekOf", { date: formatShortDate(w.weekStart, language) }) + `: ${formatDuration(w.seconds, t)}`,
            seconds: w.seconds,
          }))
        : readingTime.monthly.map((m) => ({
            key: m.month,
            label: formatMonth(m.month, language),
            tooltipLabel: `${formatMonth(m.month, language)}: ${formatDuration(m.seconds, t)}`,
            seconds: m.seconds,
          })));

  const dayOfWeekBars: Bar[] | undefined = readingTime?.byDayOfWeek.map((d) => ({
    key: String(d.dayOfWeek),
    label: formatDayOfWeek(d.dayOfWeek, language),
    tooltipLabel: `${formatDayOfWeek(d.dayOfWeek, language, "long")}: ${formatDuration(d.seconds, t)}`,
    seconds: d.seconds,
    highlighted: d.dayOfWeek === readingTime.mostActiveDayOfWeek,
  }));

  const hourBars: Bar[] | undefined = readingTime?.byHour.map((h) => ({
    key: String(h.hour),
    label: formatHour(h.hour, language),
    tooltipLabel: `${formatHour(h.hour, language)}: ${formatDuration(h.seconds, t)}`,
    seconds: h.seconds,
    highlighted: h.hour === readingTime.mostActiveHour,
  }));

  const hasReadingTimeActivity = readingTime != null && readingTime.mostActiveDayOfWeek != null;

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

            {hasReadingTimeActivity && readingTime && (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }} mb="xl">
                  <StatCard
                    label={t("analytics.mostActiveDay")}
                    value={formatDayOfWeek(readingTime.mostActiveDayOfWeek!, language, "long")}
                  />
                  <StatCard label={t("analytics.mostActiveTime")} value={formatHour(readingTime.mostActiveHour!, language)} />
                </SimpleGrid>

                <Group justify="space-between" align="center" mb="sm">
                  <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
                    {t("analytics.readingTime")}
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={period}
                    onChange={(value) => setPeriod(value as ReadingTimePeriod)}
                    data={[
                      { label: t("analytics.daily"), value: "daily" },
                      { label: t("analytics.weekly"), value: "weekly" },
                      { label: t("analytics.monthly"), value: "monthly" },
                    ]}
                  />
                </Group>
                <Card withBorder padding="lg" radius="md" mb="xl">
                  {periodBars && <BarChart bars={periodBars} />}
                </Card>

                <SimpleGrid cols={{ base: 1, md: 2 }} mb="xl">
                  <Card withBorder padding="lg" radius="md">
                    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: "0.1em" }}>
                      {t("analytics.byDayOfWeek")}
                    </Text>
                    {dayOfWeekBars && <BarChart bars={dayOfWeekBars} height={90} />}
                  </Card>
                  <Card withBorder padding="lg" radius="md">
                    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" mb="sm" style={{ letterSpacing: "0.1em" }}>
                      {t("analytics.byTimeOfDay")}
                    </Text>
                    {hourBars && <BarChart bars={hourBars} height={90} />}
                  </Card>
                </SimpleGrid>
              </>
            )}

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

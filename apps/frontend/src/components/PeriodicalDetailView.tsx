import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  FileButton,
  Group,
  Image,
  Loader,
  MultiSelect,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconCamera, IconPencil, IconTrash } from "@tabler/icons-react";
import {
  coverUrl,
  deletePeriodical,
  getPeriodical,
  listBooks,
  listPublishers,
  listTags,
  periodicalCoverUrl,
  updatePeriodical,
  uploadPeriodicalCover,
  type BookSummary,
  type PeriodicalFrequency,
} from "../api";
import { buildCreatableData } from "../creatableSelect";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { getLanguageOptions, withCurrentLanguage } from "../languageOptions";
import { BrowseViewHeader } from "./BrowseViewHeader";
import { languageDisplayName } from "./Sidebar";
import { SpineCover } from "./SpineCover";

interface PeriodicalDetailViewProps {
  periodicalId: string;
  onBack: () => void;
  onSelectBook: (id: string) => void;
}

type Granularity = "year" | "quarter" | "month" | "week" | "day" | "list";

const FREQUENCIES: PeriodicalFrequency[] = ["Daily", "Weekly", "BiWeekly", "Monthly", "Quarterly", "Yearly", "Occasional"];

// A daily/weekly periodical has too many issues for a flat list to be useful, so it defaults to a
// coarser grouping; a monthly one is manageable grouped by year; anything sparser (quarterly and
// up) is fine as a flat list by default. The user can always override via the SegmentedControl.
function defaultGranularity(frequency: PeriodicalFrequency): Granularity {
  if (frequency === "Daily" || frequency === "Weekly" || frequency === "BiWeekly") return "month";
  if (frequency === "Monthly") return "year";
  return "list";
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + ((day === 0 ? -6 : 1) - day));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function groupKeyAndLabel(issueDate: string | null, granularity: Granularity): { key: string; label: string } {
  if (granularity === "list" || !issueDate) {
    return { key: "", label: "" };
  }

  const d = new Date(issueDate);
  switch (granularity) {
    case "year":
      return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
    case "quarter": {
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      return { key: `${d.getFullYear()}-Q${quarter}`, label: `Q${quarter} ${d.getFullYear()}` };
    }
    case "month": {
      const label = d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label };
    }
    case "week": {
      const weekStart = startOfWeek(d);
      return { key: weekStart.toISOString(), label: weekStart.toLocaleDateString() };
    }
    case "day":
      return { key: issueDate, label: d.toLocaleDateString() };
  }
}

interface IssueGroup {
  key: string;
  label: string;
  issues: BookSummary[];
}

function groupIssues(issues: BookSummary[], granularity: Granularity, undatedLabel: string): IssueGroup[] {
  const sorted = [...issues].sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

  if (granularity === "list") {
    return sorted.length > 0 ? [{ key: "", label: "", issues: sorted }] : [];
  }

  const groups = new Map<string, IssueGroup>();
  for (const issue of sorted) {
    const { key, label } = groupKeyAndLabel(issue.issueDate, granularity);
    const groupKey = key || "__undated__";
    const existing = groups.get(groupKey);
    if (existing) {
      existing.issues.push(issue);
    } else {
      groups.set(groupKey, { key: groupKey, label: label || undatedLabel, issues: [issue] });
    }
  }

  return [...groups.values()];
}

// A grouped-by-date view is expected to render many small groups rather than one huge list, so
// this uses a plain SimpleGrid instead of BookGrid's virtualized one - BookGrid's virtualizer
// assumes it owns the page's scroll container, which doesn't hold when several instances are
// stacked inside one already-scrolling parent (each group here).
function IssueCard({ issue, onClick }: { issue: BookSummary; onClick: () => void }) {
  const { t } = useLanguage();
  const badge = [
    issue.volumeNumber != null ? t("periodicalDetail.volumeShort", { number: issue.volumeNumber }) : null,
    issue.issueNumber != null ? t("periodicalDetail.issueShort", { number: issue.issueNumber }) : null,
    issue.issueDate ? new Date(issue.issueDate).toLocaleDateString() : null,
  ].filter(Boolean).join(" · ");

  return (
    <UnstyledButton onClick={onClick} style={{ display: "flex", flexDirection: "column" }}>
      {issue.hasCover ? (
        <Image src={coverUrl(issue.id)} w={140} h={200} radius="sm" fit="cover" />
      ) : (
        <SpineCover id={issue.id} title={issue.title} width={140} height={200} />
      )}
      <Text size="sm" fw={600} mt={8} lineClamp={2} title={issue.title}>
        {issue.title}
      </Text>
      {badge && (
        <Text size="xs" c="dimmed">
          {badge}
        </Text>
      )}
    </UnstyledButton>
  );
}

export function PeriodicalDetailView({ periodicalId, onBack, onSelectBook }: PeriodicalDetailViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [granularityOverride, setGranularityOverride] = useState<Granularity | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    frequency: "Occasional" as PeriodicalFrequency,
    language: "",
    publisher: "",
    editor: "",
    tags: [] as string[],
  });
  const [tagSearch, setTagSearch] = useState("");

  const periodicalQuery = useQuery({ queryKey: ["periodical", periodicalId], queryFn: () => getPeriodical(periodicalId) });
  const issuesQuery = useQuery({
    queryKey: ["books", { periodicalId }],
    queryFn: () => listBooks({ periodicalId }),
  });
  const publishersQuery = useQuery({ queryKey: ["publishers"], queryFn: listPublishers });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const tagOptions = buildCreatableData((tagsQuery.data ?? []).map((tag) => tag.name), form.tags, tagSearch, t);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["periodical", periodicalId] });
    void queryClient.invalidateQueries({ queryKey: ["periodicals"] });
    // Book cards/detail show periodical-derived language/publisher nowhere directly today, but
    // tags are shared with Books' own tag list (see BookEditForm.tsx), so that needs refreshing too.
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      updatePeriodical(periodicalId, {
        name: form.name.trim(),
        frequency: form.frequency,
        description: form.description.trim() || null,
        language: form.language.trim() || null,
        publisher: form.publisher.trim() || null,
        editor: form.editor.trim() || null,
        tags: form.tags,
      }),
    onSuccess: () => {
      setEditing(false);
      setTagSearch("");
      invalidate();
    },
  });

  const coverMutation = useMutation({
    mutationFn: (file: File) => uploadPeriodicalCover(periodicalId, file),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePeriodical(periodicalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["periodicals"] });
      onBack();
    },
  });

  const startEditing = () => {
    if (!periodicalQuery.data) return;
    setForm({
      name: periodicalQuery.data.name,
      description: periodicalQuery.data.description ?? "",
      frequency: periodicalQuery.data.frequency,
      language: periodicalQuery.data.language ?? "",
      publisher: periodicalQuery.data.publisher ?? "",
      editor: periodicalQuery.data.editor ?? "",
      tags: periodicalQuery.data.tags,
    });
    setEditing(true);
  };

  const granularity = granularityOverride ?? (periodicalQuery.data ? defaultGranularity(periodicalQuery.data.frequency) : "list");
  const groups = useMemo(
    () => groupIssues(issuesQuery.data ?? [], granularity, t("periodicalDetail.undated")),
    [issuesQuery.data, granularity, t],
  );

  if (periodicalQuery.isLoading || !periodicalQuery.data) {
    return (
      <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
        <BrowseViewHeader title={t("periodicalsView.title")} onBack={onBack} />
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Box>
    );
  }

  const periodical = periodicalQuery.data;

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={periodical.name} onBack={onBack} />

      <Box p="xl" style={{ flex: 1, overflow: "auto" }}>
        <Group align="flex-start" gap="lg" mb="xl" wrap="nowrap">
          <FileButton onChange={(file) => file && coverMutation.mutate(file)} accept="image/jpeg,image/png">
            {(props) => (
              <Box {...props} pos="relative" style={{ cursor: "pointer", flexShrink: 0 }}>
                {periodical.hasCover ? (
                  <Image src={periodicalCoverUrl(periodical.id)} w={120} h={160} radius="sm" fit="cover" />
                ) : (
                  <Box
                    w={120}
                    h={160}
                    style={{
                      borderRadius: "var(--mantine-radius-sm)",
                      border: "1px dashed var(--mantine-color-default-border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconCamera size={24} color="var(--mantine-color-dimmed)" />
                  </Box>
                )}
              </Box>
            )}
          </FileButton>

          <Box style={{ flex: 1 }}>
            {editing ? (
              <Stack gap="xs" maw={420}>
                <TextInput
                  label={t("periodicalsView.namePlaceholder")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                />
                <Select
                  label={t("periodicalsView.frequency")}
                  data={FREQUENCIES.map((f) => ({ value: f, label: t(`periodicalsView.frequency.${f}` as TranslationKey) }))}
                  value={form.frequency}
                  onChange={(value) => value && setForm({ ...form, frequency: value as PeriodicalFrequency })}
                  allowDeselect={false}
                />
                <Textarea
                  label={t("periodicalDetail.description")}
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
                />
                <Group grow align="flex-start">
                  <Autocomplete
                    label={t("bookEdit.publisher")}
                    data={publishersQuery.data ?? []}
                    value={form.publisher}
                    onChange={(value) => setForm({ ...form, publisher: value })}
                  />
                  <Select
                    label={t("bookEdit.language")}
                    data={withCurrentLanguage(getLanguageOptions(t), form.language)}
                    value={form.language || null}
                    onChange={(value) => setForm({ ...form, language: value ?? "" })}
                    searchable
                    clearable
                  />
                </Group>
                <TextInput
                  label={t("periodicalDetail.editor")}
                  value={form.editor}
                  onChange={(e) => setForm({ ...form, editor: e.currentTarget.value })}
                />
                <MultiSelect
                  label={t("bookEdit.tags")}
                  data={tagOptions}
                  value={form.tags}
                  onChange={(values) => {
                    setForm({ ...form, tags: values });
                    setTagSearch("");
                  }}
                  searchable
                  searchValue={tagSearch}
                  onSearchChange={setTagSearch}
                  onBlur={() => {
                    const trimmed = tagSearch.trim();
                    if (trimmed.length > 0 && !form.tags.some((tag) => tag.toLowerCase() === trimmed.toLowerCase())) {
                      setForm((prev) => ({ ...prev, tags: [...prev.tags, trimmed] }));
                    }
                    setTagSearch("");
                  }}
                />
                <Group>
                  <Button size="xs" loading={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                    {t("common.save")}
                  </Button>
                  <Button size="xs" variant="default" onClick={() => setEditing(false)}>
                    {t("common.cancel")}
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Stack gap={4}>
                <Group gap="xs">
                  <Badge variant="light">{t(`periodicalsView.frequency.${periodical.frequency}` as TranslationKey)}</Badge>
                  <ActionIcon variant="subtle" size="sm" onClick={startEditing} aria-label={t("bookDetail.edit")}>
                    <IconPencil size={14} />
                  </ActionIcon>
                  {confirmingDelete ? (
                    <Group gap={4}>
                      <Button size="xs" color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                        {t("common.confirm")}
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setConfirmingDelete(false)}>
                        {t("common.cancel")}
                      </Button>
                    </Group>
                  ) : (
                    <Tooltip label={periodical.issueCount > 0 ? t("periodicalsView.cannotDelete") : t("periodicalsView.confirmDelete")}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        disabled={periodical.issueCount > 0}
                        onClick={() => setConfirmingDelete(true)}
                        aria-label={t("periodicalsView.confirmDelete")}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
                {periodical.description && (
                  <Text size="sm" c="dimmed">
                    {periodical.description}
                  </Text>
                )}
                {(periodical.publisher || periodical.language || periodical.editor) && (
                  <Text size="sm" c="dimmed">
                    {[
                      periodical.publisher,
                      periodical.language ? languageDisplayName(periodical.language, t) : null,
                      periodical.editor,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                )}
                {periodical.tags.length > 0 && (
                  <Group gap={4}>
                    {periodical.tags.map((tag) => (
                      <Badge key={tag} size="sm" variant="outline" color="gray" tt="none">
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Stack>
            )}
          </Box>
        </Group>

        <Group justify="space-between" mb="md">
          <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
            {t("periodicalDetail.issues")}
          </Text>
          <SegmentedControl
            size="xs"
            value={granularity}
            onChange={(value) => setGranularityOverride(value as Granularity)}
            data={[
              { value: "year", label: t("periodicalDetail.byYear") },
              { value: "quarter", label: t("periodicalDetail.byQuarter") },
              { value: "month", label: t("periodicalDetail.byMonth") },
              { value: "week", label: t("periodicalDetail.byWeek") },
              { value: "day", label: t("periodicalDetail.byDay") },
              { value: "list", label: t("periodicalDetail.byList") },
            ]}
          />
        </Group>

        {groups.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("periodicalDetail.noIssues")}
          </Text>
        )}

        <Stack gap="xl">
          {groups.map((group) => (
            <Box key={group.key}>
              {group.label && (
                <Text fw={600} size="sm" mb="sm">
                  {group.label}
                </Text>
              )}
              <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5, xl: 6 }} spacing="lg">
                {group.issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} onClick={() => onSelectBook(issue.id)} />
                ))}
              </SimpleGrid>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

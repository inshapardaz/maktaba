import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Avatar,
  Button,
  Center,
  Fieldset,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Pill,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconUser, IconWorldSearch } from "../icons";
import {
  authorImageUrl,
  createCollection,
  getBook,
  getCurrentLibrary,
  listAuthors,
  listCollections,
  listPeriodicals,
  listPublishers,
  listSeries,
  listTags,
  updateBook,
  type BookEditRequest,
  type MetadataDetails,
  type PeriodicalFrequency,
} from "../api";
import { buildCreatableData } from "../creatableSelect";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { getLanguageOptions, withCurrentLanguage } from "../languageOptions";
import { MetadataSearchDialog } from "./MetadataSearchDialog";
import { invalidateLibraryQueries } from "../queries";

interface BookEditFormProps {
  bookId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  title: string;
  authors: string[];
  language: string;
  publisher: string;
  publishedDate: string;
  description: string;
  rating: number;
  seriesName: string;
  seriesIndex: string;
  tags: string[];
  collectionIds: string[];
  periodicalId: string;
  issueNumber: string;
  volumeNumber: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  authors: [],
  language: "",
  publisher: "",
  publishedDate: "",
  description: "",
  rating: 0,
  seriesName: "",
  seriesIndex: "",
  tags: [],
  collectionIds: [],
  periodicalId: "",
  issueNumber: "",
  volumeNumber: "",
};

const STAR_RATING_OPTIONS = [
  { value: "1", label: "★" },
  { value: "2", label: "★★" },
  { value: "3", label: "★★★" },
  { value: "4", label: "★★★★" },
  { value: "5", label: "★★★★★" },
];

// Collections need a different shape from buildCreatableData (see ../creatableSelect.ts): unlike Authors/Series/Tags,
// find-or-create-by-name isn't something the book-save endpoint does server-side (BookEditRequest's
// collectionIds must already be real ids - see CLAUDE.md: "Collections are user-authored... never
// auto-derived from free text"). So the synthetic "create" entry's value is a sentinel
// (NEW_COLLECTION_PREFIX + the typed name) rather than a name/id directly - selecting it doesn't
// set collectionIds itself, it triggers an actual POST /api/collections (createCollectionMutation
// below), whose result supplies the real id. GET /api/collections always returns every collection
// (even ones with zero books, per CollectionEndpoints.cs), so unlike the name-based fields there's
// no need to separately union in "currently selected" - anything selected is already guaranteed to
// be in `existing`.
const NEW_COLLECTION_PREFIX = "__new__:";

function buildCollectionOptions(
  existing: { id: string; name: string }[],
  search: string,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): { value: string; label: string }[] {
  const options = existing.map((c) => ({ value: c.id, label: c.name }));

  const trimmed = search.trim();
  if (trimmed.length > 0 && !existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    options.push({ value: `${NEW_COLLECTION_PREFIX}${trimmed}`, label: t("bookEdit.createOption", { name: trimmed }) });
  }

  return options;
}

// The book's single "date" field (form.publishedDate, an ISO "YYYY-MM-DD" string) doubles as the
// issue date once a periodical is selected - see IssueDateField below. These converters translate
// between that one stored ISO date and whichever granularity-specific control the periodical's
// frequency calls for, so switching frequencies never needs a second piece of state to stay in sync.
function yearFromDate(date: string): string {
  return date ? date.slice(0, 4) : "";
}

function dateFromYear(year: string): string {
  return year ? `${year}-01-01` : "";
}

function quarterFromDate(date: string): { year: string; quarter: string } {
  if (!date) return { year: "", quarter: "" };
  const month = Number(date.slice(5, 7));
  return { year: date.slice(0, 4), quarter: String(Math.floor((month - 1) / 3) + 1) };
}

function dateFromQuarter(year: string, quarter: string): string {
  if (!year || !quarter) return "";
  const month = (Number(quarter) - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function monthFromDate(date: string): string {
  return date ? date.slice(0, 7) : "";
}

function dateFromMonth(month: string): string {
  return month ? `${month}-01` : "";
}

// ISO 8601 week: week 1 is the week containing the year's first Thursday: converted via UTC dates
// throughout so a local timezone offset can never shift the computed day/week by one.
function isoWeekFromDate(date: string): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function dateFromIsoWeek(isoWeek: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!match) return "";
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target.toISOString().slice(0, 10);
}

// Swaps in a granularity-matched control for the periodical's frequency (a year picker for a
// Yearly periodical, year+quarter for Quarterly, native month/week pickers for Monthly/Weekly),
// falling back to a plain date picker for Daily/BiWeekly/Occasional where no coarser grouping
// makes sense. Always reads from and writes back to the same ISO date string.
function IssueDateField({
  frequency,
  value,
  onChange,
  t,
}: {
  frequency: PeriodicalFrequency;
  value: string;
  onChange: (value: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  if (frequency === "Yearly") {
    const year = yearFromDate(value);
    return (
      <NumberInput
        label={t("bookEdit.issueDate")}
        placeholder={t("bookEdit.year")}
        allowDecimal={false}
        hideControls
        value={year === "" ? "" : Number(year)}
        onChange={(v) => onChange(dateFromYear(v === "" ? "" : String(v)))}
      />
    );
  }

  if (frequency === "Quarterly") {
    const { year, quarter } = quarterFromDate(value);
    return (
      <Group grow align="flex-end" gap="xs" wrap="nowrap">
        <NumberInput
          label={t("bookEdit.issueDate")}
          placeholder={t("bookEdit.year")}
          allowDecimal={false}
          hideControls
          value={year === "" ? "" : Number(year)}
          onChange={(v) => onChange(dateFromQuarter(v === "" ? "" : String(v), quarter || "1"))}
        />
        <Select
          data={["1", "2", "3", "4"].map((q) => ({ value: q, label: `Q${q}` }))}
          value={quarter || null}
          onChange={(v) => onChange(dateFromQuarter(year || String(new Date().getFullYear()), v ?? "1"))}
          allowDeselect={false}
        />
      </Group>
    );
  }

  if (frequency === "Monthly") {
    return (
      <TextInput
        type="month"
        label={t("bookEdit.issueDate")}
        value={monthFromDate(value)}
        onChange={(e) => onChange(dateFromMonth(e.currentTarget.value))}
      />
    );
  }

  if (frequency === "Weekly") {
    return (
      <TextInput
        type="week"
        label={t("bookEdit.issueDate")}
        value={isoWeekFromDate(value)}
        onChange={(e) => onChange(dateFromIsoWeek(e.currentTarget.value))}
      />
    );
  }

  return (
    <TextInput type="date" label={t("bookEdit.issueDate")} value={value} onChange={(e) => onChange(e.currentTarget.value)} />
  );
}

export function BookEditForm({ bookId, onClose, onSaved }: BookEditFormProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [authorSearch, setAuthorSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [metadataSearchOpen, setMetadataSearchOpen] = useState(false);
  const ratingOptions = [{ value: "0", label: t("bookEdit.unrated") }, ...STAR_RATING_OPTIONS];

  const { data: book, isLoading } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const publishersQuery = useQuery({ queryKey: ["publishers"], queryFn: listPublishers });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  // Per-library preference (Settings -> Libraries) - shares the ["library"] query App.tsx already
  // keeps warm, so this is a cache read, not an extra request.
  const libraryQuery = useQuery({ queryKey: ["library"], queryFn: getCurrentLibrary });
  const periodicalsEnabled = libraryQuery.data?.periodicalsEnabled ?? true;
  const periodicalsQuery = useQuery({ queryKey: ["periodicals"], queryFn: listPeriodicals, enabled: periodicalsEnabled });
  const collectionOptions = buildCollectionOptions(collectionsQuery.data ?? [], collectionSearch, t);

  const authorOptions = buildCreatableData(
    (authorsQuery.data ?? []).map((a) => a.name),
    form.authors,
    authorSearch,
    t,
  );
  // Case-insensitive: authors are matched/created case-insensitively server-side (EntityResolvers),
  // so a name typed with different casing than the stored author should still resolve to their avatar.
  const authorsByName = new Map((authorsQuery.data ?? []).map((a) => [a.name.toLowerCase(), a]));
  const tagOptions = buildCreatableData((tagsQuery.data ?? []).map((tag) => tag.name), form.tags, tagSearch, t);

  // Creates the collection immediately (not deferred to Save) since BookEditRequest.collectionIds
  // needs a real id to attach - see buildCollectionOptions' comment. createCollection() itself
  // upserts by name server-side, so this is safe even if collectionsQuery.data is momentarily stale.
  const createCollectionMutation = useMutation({
    mutationFn: (name: string) => createCollection(name),
    onSuccess: (created) => {
      queryClient.setQueryData<typeof collectionsQuery.data>(["collections"], (prev) =>
        prev ? (prev.some((c) => c.id === created.id) ? prev : [...prev, created]) : [created],
      );
      setForm((prev) =>
        prev.collectionIds.includes(created.id) ? prev : { ...prev, collectionIds: [...prev.collectionIds, created.id] },
      );
    },
  });

  useEffect(() => {
    if (!book) return;
    setForm({
      title: book.title,
      authors: book.authors,
      language: book.language ?? "",
      publisher: book.publisher ?? "",
      // One date field does double duty - the issue date for a periodical issue, the published
      // date otherwise (see IssueDateField) - so it's sourced from whichever one the book actually
      // has when it's an issue, falling back to publishedDate if issueDate was never set.
      publishedDate: (book.periodicalId ? book.issueDate ?? book.datePublished : book.datePublished) ?? "",
      description: book.description ?? "",
      rating: book.rating,
      seriesName: book.seriesName ?? "",
      seriesIndex: book.seriesIndex != null ? String(book.seriesIndex) : "",
      tags: book.tags,
      collectionIds: book.collections.map((c) => c.id),
      periodicalId: book.periodicalId ?? "",
      issueNumber: book.issueNumber != null ? String(book.issueNumber) : "",
      volumeNumber: book.volumeNumber != null ? String(book.volumeNumber) : "",
    });
  }, [book]);

  const saveMutation = useMutation({
    mutationFn: (edit: BookEditRequest) => updateBook(bookId, edit),
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      onSaved();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      title: form.title.trim(),
      authors: form.authors,
      language: form.language.trim() || null,
      publisher: form.publisher.trim() || null,
      publishedDate: form.publishedDate || null,
      description: form.description.trim() || null,
      rating: form.rating,
      seriesName: form.seriesName.trim() || null,
      seriesIndex: form.seriesIndex ? Number(form.seriesIndex) : null,
      tags: form.tags,
      collectionIds: form.collectionIds,
      periodicalId: form.periodicalId || null,
      issueNumber: form.periodicalId && form.issueNumber ? Number(form.issueNumber) : null,
      volumeNumber: form.periodicalId && form.volumeNumber ? Number(form.volumeNumber) : null,
      // Same single date field as publishedDate above - it *is* the issue date once a periodical
      // is selected (see IssueDateField), not a second independent value to track.
      issueDate: form.periodicalId && form.publishedDate ? form.publishedDate : null,
    });
  };

  // Issue #24: only overwrites fields the lookup actually returned data for - a match with no
  // publisher/description shouldn't blank out whatever the user (or the original file's embedded
  // metadata) already had there.
  const handleApplyMetadata = (details: MetadataDetails) => {
    setForm((prev) => ({
      ...prev,
      title: details.title || prev.title,
      authors: details.authors.length > 0 ? details.authors : prev.authors,
      publisher: details.publisher ?? prev.publisher,
      publishedDate: details.publishedDate ?? prev.publishedDate,
      description: details.description ?? prev.description,
    }));
    setMetadataSearchOpen(false);
  };

  const selectedPeriodical = periodicalsQuery.data?.find((p) => p.id === form.periodicalId);

  return (
    <Modal opened onClose={onClose} title={t("bookEdit.title")} size="lg">
      {isLoading && (
        <Center py="xl">
          <Loader />
        </Center>
      )}

      {!isLoading && (
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            {/* An issue has no user-editable title (see displayTitle in issueDisplay.ts - the
                periodical it belongs to identifies it everywhere instead), so the field is
                replaced with a plain note of which periodical this is, rather than left editable
                for a value nothing else displays. */}
            {form.periodicalId ? (
              <Text size="sm" c="dimmed">
                {t("bookEdit.issueOf", { periodical: selectedPeriodical?.name ?? "" })}
              </Text>
            ) : (
              <Group align="flex-end" gap="xs" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  label={t("bookEdit.titleField")}
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
                />
                <Button
                  variant="default"
                  size="sm"
                  leftSection={<IconWorldSearch size={15} />}
                  onClick={() => setMetadataSearchOpen(true)}
                >
                  {t("metadataSearch.button")}
                </Button>
              </Group>
            )}

            {/* Author/publisher/language/series/rating/tags/description are all hidden once the
                book is an issue of a periodical - those attributes live on the periodical instead
                (see PeriodicalDetailView.tsx's own language/publisher/editor/tags fields), not
                per-issue. Collections stay editable either way. */}
            {!form.periodicalId && (
              <MultiSelect
                label={t("bookEdit.authors")}
                data={authorOptions}
                value={form.authors}
                renderOption={({ option, checked }) => {
                  const author = authorsByName.get(String(option.value).toLowerCase());
                  return (
                    <Group gap="xs" wrap="nowrap">
                      <Avatar src={author?.hasImage ? authorImageUrl(author.id) : null} size={20} radius="xl">
                        <IconUser size={12} />
                      </Avatar>
                      <span>{option.label}</span>
                      {checked && <IconCheck size={14} style={{ marginInlineStart: "auto" }} />}
                    </Group>
                  );
                }}
                renderPill={({ option, onRemove }) => {
                  const author = authorsByName.get(String(option.value).toLowerCase());
                  return (
                    <Pill withRemoveButton onRemove={onRemove}>
                      <Group gap={4} wrap="nowrap">
                        <Avatar src={author?.hasImage ? authorImageUrl(author.id) : null} size={14} radius="xl">
                          <IconUser size={9} />
                        </Avatar>
                        <span>{option.label}</span>
                      </Group>
                    </Pill>
                  );
                }}
                onChange={(values) => {
                  setForm({ ...form, authors: values });
                  setAuthorSearch("");
                }}
                searchable
                searchValue={authorSearch}
                onSearchChange={setAuthorSearch}
                onBlur={() => {
                  // Safety net for "typed a brand new author but never explicitly clicked/selected
                  // the create option before moving on" - see buildCreatableData's comment. A no-op
                  // in the normal case, since onChange above already clears authorSearch on selection.
                  const trimmed = authorSearch.trim();
                  if (trimmed.length > 0 && !form.authors.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
                    setForm((prev) => ({ ...prev, authors: [...prev.authors, trimmed] }));
                  }
                  setAuthorSearch("");
                }}
              />
            )}

            {!form.periodicalId && (
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
            )}

            {!form.periodicalId && (
              // The date field itself moves into the Periodical fieldset (as the issue date) once
              // a periodical is selected - see IssueDateField - so this whole row, published date
              // and rating together, only makes sense for a standalone book.
              <Group grow align="flex-start">
                <TextInput
                  type="date"
                  label={t("bookEdit.publishedDate")}
                  value={form.publishedDate}
                  onChange={(e) => setForm({ ...form, publishedDate: e.currentTarget.value })}
                />
                <Select
                  label={t("bookEdit.rating")}
                  data={ratingOptions}
                  value={String(form.rating)}
                  onChange={(value) => setForm({ ...form, rating: Number(value ?? 0) })}
                  allowDeselect={false}
                />
              </Group>
            )}

            {!form.periodicalId && (
              <Group grow align="flex-start">
                {/* Plain Autocomplete, not the creatable-Select pattern used for Authors/Tags above -
                    a series name is almost always brand new per book, so a control that requires an
                    explicit dropdown selection to commit typed text (and silently discards it
                    otherwise) is exactly the wrong shape here. Autocomplete's value is the live text
                    itself, with existing series just offered as suggestions - nothing to select. */}
                <Autocomplete
                  label={t("bookEdit.series")}
                  data={(seriesQuery.data ?? []).map((s) => s.name)}
                  value={form.seriesName}
                  onChange={(value) => setForm({ ...form, seriesName: value })}
                />
                <NumberInput
                  label={t("bookEdit.seriesIndex")}
                  step={0.1}
                  value={form.seriesIndex}
                  onChange={(value) => setForm({ ...form, seriesIndex: value === "" ? "" : String(value) })}
                />
              </Group>
            )}

            {/* Hidden entirely (not just visually disabled) when this library has the feature
                turned off (Settings -> Libraries) - see periodicalsEnabled above. An already-issue
                book stays exactly as it is on disk/DB; there's just no way to change that
                assignment (or the fields hidden above) from this form while it's off. */}
            {periodicalsEnabled && (
              <Fieldset legend={t("bookEdit.periodicalFieldset")}>
                <Stack gap="sm">
                  <Select
                    label={t("bookEdit.periodical")}
                    data={(periodicalsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                    value={form.periodicalId || null}
                    onChange={(value) => setForm({ ...form, periodicalId: value ?? "" })}
                    searchable
                    clearable
                  />

                  {form.periodicalId && (
                    <>
                      <Group grow align="flex-start">
                        <NumberInput
                          label={t("bookEdit.volumeNumber")}
                          value={form.volumeNumber}
                          onChange={(value) => setForm({ ...form, volumeNumber: value === "" ? "" : String(value) })}
                        />
                        <NumberInput
                          label={t("bookEdit.issueNumber")}
                          step={0.1}
                          value={form.issueNumber}
                          onChange={(value) => setForm({ ...form, issueNumber: value === "" ? "" : String(value) })}
                        />
                      </Group>
                      <IssueDateField
                        frequency={selectedPeriodical?.frequency ?? "Occasional"}
                        value={form.publishedDate}
                        onChange={(value) => setForm({ ...form, publishedDate: value })}
                        t={t}
                      />
                    </>
                  )}
                </Stack>
              </Fieldset>
            )}

            {!form.periodicalId && (
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
            )}

            <MultiSelect
              label={t("bookEdit.collections")}
              data={collectionOptions}
              value={form.collectionIds}
              onChange={(values) => {
                // The synthetic "create" entry's value is a sentinel, not a real id (see
                // buildCollectionOptions) - picking it kicks off actual creation instead of being
                // applied to collectionIds directly; createCollectionMutation's onSuccess adds the
                // real id once the collection exists.
                const created = values.find((v) => v.startsWith(NEW_COLLECTION_PREFIX));
                if (created) {
                  createCollectionMutation.mutate(created.slice(NEW_COLLECTION_PREFIX.length));
                  setForm({ ...form, collectionIds: values.filter((v) => v !== created) });
                } else {
                  setForm({ ...form, collectionIds: values });
                }
                setCollectionSearch("");
              }}
              searchable
              clearable
              searchValue={collectionSearch}
              onSearchChange={setCollectionSearch}
              onBlur={() => {
                // Same safety net as Authors/Tags above - typed a new collection name and moved on
                // without explicitly selecting the create entry.
                const trimmed = collectionSearch.trim();
                if (trimmed.length > 0) {
                  const existingMatch = (collectionsQuery.data ?? []).find(
                    (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
                  );
                  if (existingMatch) {
                    setForm((prev) =>
                      prev.collectionIds.includes(existingMatch.id)
                        ? prev
                        : { ...prev, collectionIds: [...prev.collectionIds, existingMatch.id] },
                    );
                  } else {
                    createCollectionMutation.mutate(trimmed);
                  }
                }
                setCollectionSearch("");
              }}
            />

            {createCollectionMutation.isError && (
              <Text size="xs" c="red">
                {createCollectionMutation.error instanceof Error
                  ? createCollectionMutation.error.message
                  : String(createCollectionMutation.error)}
              </Text>
            )}

            {!form.periodicalId && (
              <Textarea
                label={t("bookEdit.description")}
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
              />
            )}

            {saveMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
              </Alert>
            )}

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={saveMutation.isPending}>
                {t("common.save")}
              </Button>
            </Group>
          </Stack>
        </form>
      )}

      {metadataSearchOpen && (
        <MetadataSearchDialog
          initialTitle={form.title}
          onApply={handleApplyMetadata}
          onClose={() => setMetadataSearchOpen(false)}
        />
      )}
    </Modal>
  );
}

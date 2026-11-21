import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Center,
  Fieldset,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Pill,
  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconCamera, IconCheck, IconUser, IconWorldSearch } from "../icons";
import {
  authorImageUrl,
  coverUrl,
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
  uploadBookCover,
  type BookEditRequest,
  type MetadataDetails,
  type PeriodicalFrequency,
} from "../api";
import { shouldAttemptCloudAsset, useCoverAvailability } from "../coverAvailability";
import { buildCreatableData } from "../creatableSelect";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { displaySubtitle, displayTitle } from "../issueDisplay";
import { getLanguageOptions, withCurrentLanguage } from "../languageOptions";
import { MetadataSearchDialog } from "./MetadataSearchDialog";
import { SpineCover } from "./SpineCover";
import { TITLEBAR_HEIGHT } from "./TitleBar";
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
  // Drives which set of fields is shown - independent of form.periodicalId itself so switching the
  // toggle to "Issue" immediately reveals the periodical/volume/issue fields (see the Fieldset
  // below) even before a periodical has actually been picked yet, rather than needing a periodical
  // already selected before the layout would switch. Synced from the loaded book in the effect
  // below; toggling back to "Book" also clears form.periodicalId there so a save while on "Book"
  // can never still carry a stale periodical assignment.
  const [mode, setMode] = useState<"book" | "issue">("book");
  const [authorSearch, setAuthorSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [metadataSearchOpen, setMetadataSearchOpen] = useState(false);

  const { data: book, isLoading } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });
  const cover = useCoverAvailability(book?.id ?? "", book?.coverVersion, book?.hasCover ?? false);

  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const seriesQuery = useQuery({ queryKey: ["series"], queryFn: listSeries });
  // Includes a tag with zero books currently attached (unlike the sidebar's ["tags"] query) - see
  // listTags's own doc comment - so untagging a tag's last book doesn't make it vanish from this
  // picker's suggestions.
  const tagsQuery = useQuery({ queryKey: ["tags", "all"], queryFn: () => listTags(true) });
  const publishersQuery = useQuery({ queryKey: ["publishers"], queryFn: listPublishers });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  // Per-library preference (Settings -> Libraries) - shares the ["library"] query App.tsx already
  // keeps warm, so this is a cache read, not an extra request.
  const libraryQuery = useQuery({ queryKey: ["library"], queryFn: getCurrentLibrary });
  const periodicalsEnabled = libraryQuery.data?.periodicalsEnabled ?? true;
  const providerType = libraryQuery.data?.providerType;
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

  // Overwrites whatever cover the book has now (same pattern as PeriodicalDetailView's own cover
  // upload) - invalidates both this book's own query (coverVersion changes, busting coverUrl's
  // cache-buster) and the broader library queries that also render this book's cover (grid/list).
  const coverMutation = useMutation({
    mutationFn: (file: File) => uploadBookCover(bookId, file),
    onSuccess: () => {
      invalidateLibraryQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
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
    setMode(book.periodicalId ? "issue" : "book");
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
    <Modal.Root
      opened
      onClose={onClose}
      fullScreen
      radius={0}
      // fullScreen alone positions the modal over the whole viewport, including the app's own
      // draggable title bar (AppShell.Header, TITLEBAR_HEIGHT tall - see TitleBar.tsx) - that bar
      // is how a frameless window gets moved/minimized/closed, so it has to stay reachable while
      // this dialog is open. Shifting the overlay/inner/content down by that same height keeps the
      // dialog filling the rest of the client area without covering it.
      styles={{
        overlay: { top: TITLEBAR_HEIGHT },
        inner: { top: TITLEBAR_HEIGHT },
        content: {
          height: `calc(100dvh - ${TITLEBAR_HEIGHT}px)`,
          maxHeight: `calc(100dvh - ${TITLEBAR_HEIGHT}px)`,
        },
        body: { display: "flex", flexDirection: "column", flex: 1, padding: 0, minHeight: 0 },
      }}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header p="xs">
          <Modal.Title>{t("bookEdit.title")}</Modal.Title>
          {/* Grouped right next to the close button (rather than beside the title) - both compound
              Modal.Header slots land at opposite ends via its own space-between layout, so this is
              the toggle's own slot, immediately before Modal.CloseButton. Only offered when this
              library has periodicals turned on at all (Settings -> Libraries) - same gate the
              Periodical fieldset itself used to be hidden behind. Switching to "Book" clears
              form.periodicalId immediately so the fields below react to it the same way loading a
              standalone book would; switching to "Issue" leaves it empty until the Select inside
              the Periodical fieldset is actually used to pick one - mode alone is what reveals that
              fieldset (see the SimpleGrid further down). */}
          <Group gap="sm" wrap="nowrap">
            {periodicalsEnabled && (
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={(value) => {
                  const next = value as "book" | "issue";
                  setMode(next);
                  if (next === "book") {
                    setForm((prev) => ({ ...prev, periodicalId: "" }));
                  }
                }}
                data={[
                  { value: "book", label: t("bookEdit.modeBook") },
                  { value: "issue", label: t("bookEdit.modeIssue") },
                ]}
              />
            )}
            <Modal.CloseButton />
          </Group>
        </Modal.Header>
        <Modal.Body>
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {!isLoading && book && (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <Group align="flex-start" gap="xl" wrap="nowrap" p="lg" style={{ flex: 1, minHeight: 0 }}>
                {/* Comes first in document order so it lands on whichever side is the reading
                direction's "start" (left in LTR, right in RTL) - plain flexbox row placement,
                no direction-specific logic needed. */}
                <Stack gap="xs" style={{ flexShrink: 0, width: 220 }}>
                  <FileButton onChange={(file) => file && coverMutation.mutate(file)} accept="image/jpeg,image/png">
                    {(props) => (
                      <Box {...props} pos="relative" style={{ cursor: "pointer", width: 220, height: 330 }}>
                        {cover.available ? (
                          <Image
                            src={coverUrl(book.id, book.coverVersion)}
                            alt=""
                            w={220}
                            h={330}
                            fit="cover"
                            radius="sm"
                            style={{
                              border: "1px solid var(--mantine-color-default-border)",
                              boxShadow: "var(--mantine-shadow-sm)",
                            }}
                            onError={cover.onError}
                          />
                        ) : (
                          <SpineCover
                            id={book.id}
                            title={displayTitle(book, t)}
                            author={displaySubtitle(book, t)}
                            width={220}
                            height={330}
                            titleSize={20}
                            metaSize={12}
                            padding={14}
                          />
                        )}
                        {/* Always-visible affordance (rather than hover-only) - a touch/no-hover
                        session should be able to tell the cover is editable too. */}
                        <Box
                          pos="absolute"
                          style={{
                            insetInlineEnd: 8,
                            bottom: 8,
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "var(--mantine-color-body)",
                            border: "1px solid var(--mantine-color-default-border)",
                            boxShadow: "var(--mantine-shadow-sm)",
                          }}
                        >
                          {coverMutation.isPending ? <Loader size={14} /> : <IconCamera size={16} />}
                        </Box>
                      </Box>
                    )}
                  </FileButton>

                  {coverMutation.isError && (
                    <Text size="xs" c="red">
                      {coverMutation.error instanceof Error ? coverMutation.error.message : String(coverMutation.error)}
                    </Text>
                  )}

                  {/* Language/published date live here, under the cover, rather than beside the
                  rest of the metadata fields - narrow one-per-row controls that fit the cover's own
                  220px column instead of competing for space in the wider fields column. Rating
                  itself isn't editable from here at all - BookDetailPanel has its own star widget
                  for that, and form.rating/the Save payload still carry whatever value the book
                  already had untouched. */}
                  {mode === "book" && (
                    <Stack gap="xs" mt="xs">
                      <Select
                        label={t("bookEdit.language")}
                        data={withCurrentLanguage(getLanguageOptions(t), form.language)}
                        value={form.language || null}
                        onChange={(value) => setForm({ ...form, language: value ?? "" })}
                        searchable
                        clearable
                      />
                      {/* Year-only, not a full date picker - a book's title page rarely gives more
                      than the year anyway, and the stored value (form.publishedDate, an ISO date
                      string) still round-trips through yearFromDate/dateFromYear the same way
                      IssueDateField's own Yearly case does. This field itself moves into the
                      Periodical fieldset (as the issue date) once a periodical is selected - see
                      IssueDateField - so it only makes sense for a standalone book. */}
                      <NumberInput
                        label={t("bookEdit.publishedYear")}
                        allowDecimal={false}
                        hideControls
                        value={yearFromDate(form.publishedDate) === "" ? "" : Number(yearFromDate(form.publishedDate))}
                        onChange={(value) => setForm({ ...form, publishedDate: dateFromYear(value === "" ? "" : String(value)) })}
                      />
                    </Stack>
                  )}
                </Stack>

                <ScrollArea type="auto" style={{ flex: 1, minHeight: 0, alignSelf: "stretch" }} scrollbarSize={8}>
                  <Stack gap="sm">
                    {/* An issue has no user-editable title (see displayTitle in issueDisplay.ts - the
                    periodical it belongs to identifies it everywhere instead), so the field is
                    replaced with a plain note of which periodical this is, rather than left editable
                    for a value nothing else displays. Nothing shows yet if "Issue" was just picked
                    from the header toggle and no periodical has actually been selected below. */}
                    {mode === "issue" ? (
                      form.periodicalId && (
                        <Text size="sm" c="dimmed">
                          {t("bookEdit.issueOf", { periodical: selectedPeriodical?.name ?? "" })}
                        </Text>
                      )
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

                    {/* Author/publisher/language/series/rating/tags/description are all hidden in "Issue"
                mode - those attributes live on the periodical instead (see PeriodicalDetailView.tsx's
                own language/publisher/editor/tags fields), not per-issue. Collections stay editable
                either way. */}
                    {mode === "book" && (
                      <MultiSelect
                        label={t("bookEdit.authors")}
                        data={authorOptions}
                        value={form.authors}
                        renderOption={({ option, checked }) => {
                          const author = authorsByName.get(String(option.value).toLowerCase());
                          return (
                            <Group gap="xs" wrap="nowrap">
                              <Avatar
                                src={author && shouldAttemptCloudAsset(author.hasImage, providerType) ? authorImageUrl(author.id) : null}
                                size={20}
                                radius="xl"
                              >
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
                                <Avatar
                                  src={author && shouldAttemptCloudAsset(author.hasImage, providerType) ? authorImageUrl(author.id) : null}
                                  size={14}
                                  radius="xl"
                                >
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

                    {mode === "book" && (
                      <Autocomplete
                        label={t("bookEdit.publisher")}
                        data={publishersQuery.data ?? []}
                        value={form.publisher}
                        onChange={(value) => setForm({ ...form, publisher: value })}
                      />
                    )}

                    {/* Exactly one of these two shows at a time, driven by the header toggle - "Book" gets
                the Series fieldset, "Issue" (only reachable at all when this library has
                periodicals turned on - see periodicalsEnabled above) gets the periodical/volume/
                issue fields instead. */}
                    {mode === "book" && (
                      <Fieldset legend={t("bookEdit.series")}>
                        <SimpleGrid cols={2}>
                          {/* Plain Autocomplete, not the creatable-Select pattern used for Authors/Tags
                      above - a series name is almost always brand new per book, so a control that
                      requires an explicit dropdown selection to commit typed text (and silently
                      discards it otherwise) is exactly the wrong shape here. Autocomplete's value
                      is the live text itself, with existing series just offered as suggestions -
                      nothing to select. */}
                          <Autocomplete
                            label={t("bookEdit.series")}
                            data={(seriesQuery.data ?? []).map((s) => s.name)}
                            value={form.seriesName}
                            onChange={(value) => setForm({ ...form, seriesName: value })}
                          />
                          <NumberInput
                            label={t("bookEdit.seriesIndex")}
                            step={1}
                            min={0}
                            max={9999}
                            value={form.seriesIndex}
                            onChange={(value) => setForm({ ...form, seriesIndex: value === "" ? "" : String(value) })}
                          />
                        </SimpleGrid>
                      </Fieldset>
                    )}

                    {periodicalsEnabled && mode === "issue" && (
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

                    {/* Tags is hidden in "Issue" mode (see the big comment above the Authors field) -
                Collections stays editable either way, so it takes the full row by itself rather
                than leaving an empty second column next to it. */}
                    <SimpleGrid cols={mode === "issue" ? 1 : 2}>
                      {mode === "book" && (
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
                    </SimpleGrid>

                    {createCollectionMutation.isError && (
                      <Text size="xs" c="red">
                        {createCollectionMutation.error instanceof Error
                          ? createCollectionMutation.error.message
                          : String(createCollectionMutation.error)}
                      </Text>
                    )}

                    {mode === "book" && (
                      <Textarea
                        label={t("bookEdit.description")}
                        rows={3}
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
                      />
                    )}
                  </Stack>
                </ScrollArea>
              </Group>

              {/* Kept outside the ScrollArea above (rather than as its last item) so Save/Cancel - and
              any save error - stay visible without scrolling down to them, however long the form
              above gets. */}
              <Stack gap="xs" p="sm" pt="sm" style={{ flexShrink: 0, borderTop: "1px solid var(--mantine-color-default-border)" }}>
                {saveMutation.isError && (
                  <Alert color="red" icon={<IconAlertCircle size={18} />}>
                    {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
                  </Alert>
                )}

                <Group justify="flex-end">
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
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

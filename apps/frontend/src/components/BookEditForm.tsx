import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import {
  createCollection,
  getBook,
  listAuthors,
  listCollections,
  listPublishers,
  listSeries,
  listTags,
  updateBook,
  type BookEditRequest,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

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
};

const STAR_RATING_OPTIONS = [
  { value: "1", label: "★" },
  { value: "2", label: "★★" },
  { value: "3", label: "★★★" },
  { value: "4", label: "★★★★" },
  { value: "5", label: "★★★★★" },
];

// Common library languages - stored as ISO 639-1 codes (matches what's typically already in EPUB/
// PDF metadata's dc:language, so an edit made here round-trips with a rescan instead of drifting
// into a different format) with their English display name as the label. Not exhaustive -
// withCurrentLanguage below makes sure a book already tagged with a code outside this list still
// shows correctly instead of silently going blank.
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu" },
  { value: "ar", label: "Arabic" },
  { value: "fa", label: "Persian" },
  { value: "hi", label: "Hindi" },
  { value: "bn", label: "Bengali" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "pl", label: "Polish" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
];

// Keeps a Select's current value visible/selected even when it falls outside the curated
// LANGUAGE_OPTIONS list (e.g. a regional code like "en-US", or something extraction found that
// isn't in the list at all) - appended as a plain extra option (label = the raw code itself, since
// there's no display name to look up) rather than dropped, so editing an already-set field doesn't
// silently blank it out.
function withCurrentLanguage(
  options: { value: string; label: string }[],
  current: string,
): { value: string; label: string }[] {
  const trimmed = current.trim();
  if (trimmed.length > 0 && !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())) {
    return [...options, { value: trimmed, label: trimmed }];
  }
  return options;
}

// Mantine's Select/MultiSelect have no built-in "create a new option" support (removed after v6) -
// this is the standard replacement: the dropdown's own `data` always includes every existing name
// plus whatever's currently selected (so already-chosen custom values keep resolving to a label
// even once they scroll out of the current search text), and a synthetic "+ Create "X"" entry is
// appended only while the typed search doesn't already match something. Selecting that entry just
// selects its `value`, which is the typed text itself - no separate "was this newly created" case
// to handle on save, since find-or-create happens server-side (EntityResolvers) exactly as it
// already does for the free-text fields this replaces.
//
// Note this still requires an explicit selection (click, or Enter on the highlighted option) to
// commit typed text - fine for Authors/Tags where existing-option selection is the common case, but
// for a field like Series (usually a brand new value per book) that gap is a real trap: type a name
// and click straight to Save without selecting from the dropdown, and the text is silently
// discarded. MultiSelect's own onBlur handler below is a safety net for exactly that; Series itself
// was switched to a plain Autocomplete instead (see below), which has no such gap at all - its
// value is the live text, always, with no separate "search vs. selected" state to fall out of sync.
function buildCreatableData(
  existing: string[],
  selected: string[],
  search: string,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): { value: string; label: string }[] {
  const names = [...new Set([...existing, ...selected])].sort((a, b) => a.localeCompare(b));
  const options = names.map((name) => ({ value: name, label: name }));

  const trimmed = search.trim();
  if (trimmed.length > 0 && !names.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
    options.push({ value: trimmed, label: t("bookEdit.createOption", { name: trimmed }) });
  }

  return options;
}

// Collections need a different shape from buildCreatableData above: unlike Authors/Series/Tags,
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

export function BookEditForm({ bookId, onClose, onSaved }: BookEditFormProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [authorSearch, setAuthorSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
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
  const collectionOptions = buildCollectionOptions(collectionsQuery.data ?? [], collectionSearch, t);

  const authorOptions = buildCreatableData(
    (authorsQuery.data ?? []).map((a) => a.name),
    form.authors,
    authorSearch,
    t,
  );
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
      publishedDate: book.datePublished ?? "",
      description: book.description ?? "",
      rating: book.rating,
      seriesName: book.seriesName ?? "",
      seriesIndex: book.seriesIndex != null ? String(book.seriesIndex) : "",
      tags: book.tags,
      collectionIds: book.collections.map((c) => c.id),
    });
  }, [book]);

  const saveMutation = useMutation({
    mutationFn: (edit: BookEditRequest) => updateBook(bookId, edit),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      void queryClient.invalidateQueries({ queryKey: ["authors"] });
      void queryClient.invalidateQueries({ queryKey: ["series"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      void queryClient.invalidateQueries({ queryKey: ["publishers"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
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
    });
  };

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
            <TextInput
              label={t("bookEdit.titleField")}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
            />

            <MultiSelect
              label={t("bookEdit.authors")}
              data={authorOptions}
              value={form.authors}
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

            <Group grow align="flex-start">
              <Autocomplete
                label={t("bookEdit.publisher")}
                data={publishersQuery.data ?? []}
                value={form.publisher}
                onChange={(value) => setForm({ ...form, publisher: value })}
              />
              <Select
                label={t("bookEdit.language")}
                data={withCurrentLanguage(LANGUAGE_OPTIONS, form.language)}
                value={form.language || null}
                onChange={(value) => setForm({ ...form, language: value ?? "" })}
                searchable
                clearable
              />
            </Group>

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

            <Textarea
              label={t("bookEdit.description")}
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
            />

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
    </Modal>
  );
}

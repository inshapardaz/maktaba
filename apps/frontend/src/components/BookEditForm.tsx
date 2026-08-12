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
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import {
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

// Mantine's Select/MultiSelect have no built-in "create a new option" support (removed after v6) -
// this is the standard replacement: the dropdown's own `data` always includes every existing name
// plus whatever's currently selected (so already-chosen custom values keep resolving to a label
// even once they scroll out of the current search text), and a synthetic "+ Create "X"" entry is
// appended only while the typed search doesn't already match something. Selecting that entry just
// selects its `value`, which is the typed text itself - no separate "was this newly created" case
// to handle on save, since find-or-create happens server-side (EntityResolvers) exactly as it
// already does for the free-text fields this replaces.
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

export function BookEditForm({ bookId, onClose, onSaved }: BookEditFormProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [authorSearch, setAuthorSearch] = useState("");
  const [seriesSearch, setSeriesSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
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
  const collectionOptions = (collectionsQuery.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  const authorOptions = buildCreatableData(
    (authorsQuery.data ?? []).map((a) => a.name),
    form.authors,
    authorSearch,
    t,
  );
  const seriesOptions = buildCreatableData(
    (seriesQuery.data ?? []).map((s) => s.name),
    form.seriesName ? [form.seriesName] : [],
    seriesSearch,
    t,
  );
  const tagOptions = buildCreatableData((tagsQuery.data ?? []).map((tag) => tag.name), form.tags, tagSearch, t);

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

            <Group grow align="flex-start">
              <Autocomplete
                label={t("bookEdit.publisher")}
                data={publishersQuery.data ?? []}
                value={form.publisher}
                onChange={(value) => setForm({ ...form, publisher: value })}
              />
              <TextInput
                label={t("bookEdit.language")}
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.currentTarget.value })}
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
            />

            <Group grow align="flex-start">
              <Select
                label={t("bookEdit.series")}
                data={seriesOptions}
                value={form.seriesName || null}
                onChange={(value) => {
                  setForm({ ...form, seriesName: value ?? "" });
                  setSeriesSearch("");
                }}
                searchable
                clearable
                searchValue={seriesSearch}
                onSearchChange={setSeriesSearch}
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
            />

            <MultiSelect
              label={t("bookEdit.collections")}
              data={collectionOptions}
              value={form.collectionIds}
              onChange={(value) => setForm({ ...form, collectionIds: value })}
              searchable
              clearable
            />

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

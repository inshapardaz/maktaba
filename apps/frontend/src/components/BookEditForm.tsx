import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
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
import { getBook, listCollections, updateBook, type BookEditRequest } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface BookEditFormProps {
  bookId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  title: string;
  authors: string;
  language: string;
  publisher: string;
  publishedDate: string;
  description: string;
  rating: number;
  seriesName: string;
  seriesIndex: string;
  tags: string;
  collectionIds: string[];
}

const EMPTY_FORM: FormState = {
  title: "",
  authors: "",
  language: "",
  publisher: "",
  publishedDate: "",
  description: "",
  rating: 0,
  seriesName: "",
  seriesIndex: "",
  tags: "",
  collectionIds: [],
};

const STAR_RATING_OPTIONS = [
  { value: "1", label: "★" },
  { value: "2", label: "★★" },
  { value: "3", label: "★★★" },
  { value: "4", label: "★★★★" },
  { value: "5", label: "★★★★★" },
];

export function BookEditForm({ bookId, onClose, onSaved }: BookEditFormProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const ratingOptions = [{ value: "0", label: t("bookEdit.unrated") }, ...STAR_RATING_OPTIONS];

  const { data: book, isLoading } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  const collectionOptions = (collectionsQuery.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  useEffect(() => {
    if (!book) return;
    setForm({
      title: book.title,
      authors: book.authors.join(", "),
      language: book.language ?? "",
      publisher: book.publisher ?? "",
      publishedDate: book.datePublished ?? "",
      description: book.description ?? "",
      rating: book.rating,
      seriesName: book.seriesName ?? "",
      seriesIndex: book.seriesIndex != null ? String(book.seriesIndex) : "",
      tags: book.tags.join(", "),
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
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      onSaved();
    },
  });

  const splitList = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      title: form.title.trim(),
      authors: splitList(form.authors),
      language: form.language.trim() || null,
      publisher: form.publisher.trim() || null,
      publishedDate: form.publishedDate || null,
      description: form.description.trim() || null,
      rating: form.rating,
      seriesName: form.seriesName.trim() || null,
      seriesIndex: form.seriesIndex ? Number(form.seriesIndex) : null,
      tags: splitList(form.tags),
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

            <TextInput
              label={t("bookEdit.authors")}
              description={t("bookEdit.commaSeparated")}
              value={form.authors}
              onChange={(e) => setForm({ ...form, authors: e.currentTarget.value })}
            />

            <Group grow align="flex-start">
              <TextInput
                label={t("bookEdit.series")}
                value={form.seriesName}
                onChange={(e) => setForm({ ...form, seriesName: e.currentTarget.value })}
              />
              <NumberInput
                label={t("bookEdit.seriesIndex")}
                step={0.1}
                value={form.seriesIndex}
                onChange={(value) => setForm({ ...form, seriesIndex: value === "" ? "" : String(value) })}
              />
            </Group>

            <TextInput
              label={t("bookEdit.tags")}
              description={t("bookEdit.commaSeparated")}
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.currentTarget.value })}
            />

            <MultiSelect
              label={t("bookEdit.collections")}
              data={collectionOptions}
              value={form.collectionIds}
              onChange={(value) => setForm({ ...form, collectionIds: value })}
              searchable
              clearable
            />

            <Group grow align="flex-start">
              <TextInput
                label={t("bookEdit.publisher")}
                value={form.publisher}
                onChange={(e) => setForm({ ...form, publisher: e.currentTarget.value })}
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

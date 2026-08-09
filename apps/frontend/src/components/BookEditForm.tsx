import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBook, updateBook, type BookEditRequest } from "../api";

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
};

export function BookEditForm({ bookId, onClose, onSaved }: BookEditFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: book, isLoading } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

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
    });
  };

  return (
    <div className="book-detail-overlay" onClick={onClose}>
      <div className="book-detail-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-button" onClick={onClose}>
          ×
        </button>

        <h2>Edit book</h2>

        {isLoading && <p>Loading…</p>}

        {!isLoading && (
          <form className="book-edit-form" onSubmit={handleSubmit}>
            <label>
              Title
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>

            <label>
              Authors (comma-separated)
              <input
                type="text"
                value={form.authors}
                onChange={(e) => setForm({ ...form, authors: e.target.value })}
              />
            </label>

            <div className="form-row">
              <label>
                Series
                <input
                  type="text"
                  value={form.seriesName}
                  onChange={(e) => setForm({ ...form, seriesName: e.target.value })}
                />
              </label>
              <label className="form-row-narrow">
                Series #
                <input
                  type="number"
                  step="0.1"
                  value={form.seriesIndex}
                  onChange={(e) => setForm({ ...form, seriesIndex: e.target.value })}
                />
              </label>
            </div>

            <label>
              Tags (comma-separated)
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </label>

            <div className="form-row">
              <label>
                Publisher
                <input
                  type="text"
                  value={form.publisher}
                  onChange={(e) => setForm({ ...form, publisher: e.target.value })}
                />
              </label>
              <label>
                Language
                <input
                  type="text"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                Published date
                <input
                  type="date"
                  value={form.publishedDate}
                  onChange={(e) => setForm({ ...form, publishedDate: e.target.value })}
                />
              </label>
              <label className="form-row-narrow">
                Rating
                <select
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "Unrated" : "★".repeat(n)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Description
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>

            {saveMutation.isError && (
              <p className="error-text">
                {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
              </p>
            )}

            <div className="form-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

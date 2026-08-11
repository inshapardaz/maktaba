import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from "@mantine/spotlight";
import { IconBook2, IconFolder, IconSearch, IconTag, IconUser } from "@tabler/icons-react";
import { listAuthors, listBooks, listCollections, listTags } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { useDebounced } from "../useDebounced";
import type { GroupFilter } from "./Sidebar";

type SpotlightActions = SpotlightActionData | SpotlightActionGroupData;

const RESULT_LIMIT = 5;

interface LibrarySpotlightProps {
  onSelectBook: (bookId: string) => void;
  onSelectFilter: (filter: GroupFilter) => void;
  onSearch: (query: string) => void;
}

export function LibrarySpotlight({ onSelectBook, onSelectFilter, onSearch }: LibrarySpotlightProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 200);
  const trimmed = debouncedQuery.trim();
  const needle = trimmed.toLowerCase();

  // Books need a live query (title/author/series/tag match, server-side) - Authors/Tags/Collections
  // reuse the same query keys the sidebar already populates, so this is usually just filtering
  // already-cached data rather than firing new requests.
  const booksQuery = useQuery({
    queryKey: ["spotlightBooks", trimmed],
    queryFn: () => listBooks({ search: trimmed }),
    enabled: trimmed.length > 0,
  });
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: listCollections });

  const actions = useMemo<SpotlightActions[]>(() => {
    if (needle.length === 0) {
      return [];
    }

    const matches = (name: string) => name.toLowerCase().includes(needle);
    const groups: SpotlightActions[] = [];

    const bookActions: SpotlightActionData[] = (booksQuery.data ?? []).slice(0, RESULT_LIMIT).map((book) => ({
      id: `spotlight-book-${book.id}`,
      label: book.title,
      description: book.authors.join(", ") || t("common.unknownAuthor"),
      leftSection: <IconBook2 size={16} />,
      onClick: () => onSelectBook(book.id),
    }));
    if (bookActions.length > 0) {
      groups.push({ group: t("spotlight.books"), actions: bookActions });
    }

    const authorActions: SpotlightActionData[] = (authorsQuery.data ?? [])
      .filter((author) => matches(author.name))
      .slice(0, RESULT_LIMIT)
      .map((author) => ({
        id: `spotlight-author-${author.id}`,
        label: author.name,
        leftSection: <IconUser size={16} />,
        onClick: () => onSelectFilter({ kind: "authorId", id: author.id, name: author.name }),
      }));
    if (authorActions.length > 0) {
      groups.push({ group: t("sidebar.authors"), actions: authorActions });
    }

    const tagActions: SpotlightActionData[] = (tagsQuery.data ?? [])
      .filter((tag) => matches(tag.name))
      .slice(0, RESULT_LIMIT)
      .map((tag) => ({
        id: `spotlight-tag-${tag.id}`,
        label: tag.name,
        leftSection: <IconTag size={16} />,
        onClick: () => onSelectFilter({ kind: "tagId", id: tag.id, name: tag.name }),
      }));
    if (tagActions.length > 0) {
      groups.push({ group: t("sidebar.tags"), actions: tagActions });
    }

    const collectionActions: SpotlightActionData[] = (collectionsQuery.data ?? [])
      .filter((collection) => matches(collection.name))
      .slice(0, RESULT_LIMIT)
      .map((collection) => ({
        id: `spotlight-collection-${collection.id}`,
        label: collection.name,
        leftSection: <IconFolder size={16} />,
        onClick: () => onSelectFilter({ kind: "collectionId", id: collection.id, name: collection.name }),
      }));
    if (collectionActions.length > 0) {
      groups.push({ group: t("sidebar.collections"), actions: collectionActions });
    }

    // Ungrouped, always last - the escape hatch into the full filterable/sortable grid for
    // whatever didn't fit in the instant-results sections above.
    groups.push({
      id: "spotlight-search-all",
      label: t("spotlight.searchFor", { query: trimmed }),
      leftSection: <IconSearch size={16} />,
      onClick: () => onSearch(trimmed),
    });

    return groups;
  }, [needle, trimmed, booksQuery.data, authorsQuery.data, tagsQuery.data, collectionsQuery.data, t, onSelectBook, onSelectFilter, onSearch]);

  return (
    <Spotlight
      query={query}
      onQueryChange={setQuery}
      actions={actions}
      // Results above are already filtered to the current query - default title/description
      // substring filtering would just re-run the same work, so this is an identity pass-through.
      filter={(_q, matchedActions) => matchedActions}
      nothingFound={needle.length === 0 ? t("spotlight.prompt") : t("spotlight.noResults")}
      searchProps={{
        leftSection: <IconSearch size={18} />,
        placeholder: t("toolbar.searchPlaceholder"),
      }}
      highlightQuery
      limit={200}
    />
  );
}

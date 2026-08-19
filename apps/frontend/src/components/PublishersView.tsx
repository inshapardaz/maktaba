import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, NavLink, Stack, Text, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { listPublisherGroups } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import type { GroupFilter } from "./Sidebar";

interface PublishersViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

// Unlike AuthorsView/SeriesView/TagsView, there's no rename here - Publisher is a plain string
// field on Book (see backend BrowseEndpoints.cs), not a normalized entity with its own row to
// rename, so this is browse-and-select only.
export function PublishersView({ onSelect, onBack }: PublishersViewProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const publishersQuery = useQuery({ queryKey: ["publisherGroups"], queryFn: listPublisherGroups });

  const filtered = useMemo(() => {
    const publishers = publishersQuery.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? publishers.filter((p) => p.name.toLowerCase().includes(term)) : publishers;
  }, [publishersQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("publishersView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <TextInput
          mb="md"
          placeholder={t("publishersView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("publishersView.empty")}
            </Text>
          )}

          {filtered.map((publisher) => (
            <NavLink
              key={publisher.id}
              label={publisher.name}
              onClick={() => {
                onSelect({ kind: "publisher", id: publisher.id, name: publisher.name });
                onBack();
              }}
              rightSection={
                <Badge size="sm" variant="light" color="gray">
                  {publisher.bookCount}
                </Badge>
              }
              px="sm"
              py={7}
              styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

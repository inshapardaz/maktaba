import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, NavLink, Stack, Text, TextInput } from "@mantine/core";
import { IconSearch } from "../icons";
import { listLanguageGroups } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import { languageDisplayName, type GroupFilter } from "./Sidebar";

interface LanguagesViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

// Unlike AuthorsView/SeriesView/TagsView, there's no rename here - Language is a plain string
// field on Book (see backend BrowseEndpoints.cs), not a normalized entity with its own row to
// rename, so this is browse-and-select only. Mirrors PublishersView.tsx, but the raw ISO 639-1
// code (the group's id) is shown/searched as its translated display name via languageDisplayName.
export function LanguagesView({ onSelect, onBack }: LanguagesViewProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const languagesQuery = useQuery({ queryKey: ["languageGroups"], queryFn: listLanguageGroups });

  const languages = useMemo(
    () => (languagesQuery.data ?? []).map((l) => ({ ...l, name: languageDisplayName(l.id, t) })),
    [languagesQuery.data, t],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? languages.filter((l) => l.name.toLowerCase().includes(term)) : languages;
  }, [languages, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("languagesView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <TextInput
          mb="md"
          placeholder={t("languagesView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("languagesView.empty")}
            </Text>
          )}

          {filtered.map((lang) => (
            <NavLink
              key={lang.id}
              label={lang.name}
              onClick={() => {
                onSelect({ kind: "language", id: lang.id, name: lang.name });
                onBack();
              }}
              rightSection={
                <Badge size="sm" variant="light" color="gray">
                  {lang.bookCount}
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

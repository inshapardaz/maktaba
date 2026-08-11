import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActionIcon, Box, Group, NavLink, ScrollArea, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { listAuthors } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { GroupFilter } from "./Sidebar";

interface AuthorsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

export function AuthorsView({ onSelect, onBack }: AuthorsViewProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });

  const filtered = useMemo(() => {
    const authors = authorsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? authors.filter((a) => a.name.toLowerCase().includes(term)) : authors;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [authorsQuery.data, search]);

  return (
    <Box p="xl" maw={640}>
      <Group mb="lg" gap="sm">
        <ActionIcon variant="default" onClick={onBack} aria-label={t("common.back")}>
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Title order={2}>{t("authorsView.title")}</Title>
      </Group>

      <TextInput
        mb="md"
        placeholder={t("authorsView.searchPlaceholder")}
        leftSection={<IconSearch size={15} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      <ScrollArea.Autosize mah="calc(100vh - 220px)">
        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("authorsView.empty")}
            </Text>
          )}

          {filtered.map((author) => (
            <NavLink
              key={author.id}
              label={author.name}
              onClick={() => {
                onSelect({ kind: "authorId", id: author.id, name: author.name });
                onBack();
              }}
              rightSection={
                <Text size="xs" c="dimmed">
                  {author.bookCount}
                </Text>
              }
              px="sm"
              py={7}
              styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Box>
  );
}

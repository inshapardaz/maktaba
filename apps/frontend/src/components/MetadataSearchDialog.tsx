import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Center,
  Group,
  Image,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { getMetadataDetails, searchMetadata, type MetadataDetails, type MetadataSearchResult } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface MetadataSearchDialogProps {
  initialTitle: string;
  onApply: (details: MetadataDetails) => void;
  onClose: () => void;
}

export function MetadataSearchDialog({ initialTitle, onApply, onClose }: MetadataSearchDialogProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState(initialTitle);
  const [selected, setSelected] = useState<MetadataSearchResult | null>(null);

  const searchMutation = useMutation({ mutationFn: (q: string) => searchMetadata(q) });
  const detailsMutation = useMutation({
    mutationFn: (result: MetadataSearchResult) => getMetadataDetails(result.key, result.isbn),
  });

  // Auto-search once on open with whatever title the book already has - the common case is
  // refining an existing title, not typing one from scratch.
  useEffect(() => {
    if (initialTitle.trim().length > 0) {
      searchMutation.mutate(initialTitle.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      searchMutation.mutate(trimmed);
    }
  };

  const handleSelect = (result: MetadataSearchResult) => {
    setSelected(result);
    detailsMutation.mutate(result);
  };

  const handleApply = () => {
    if (detailsMutation.data) {
      onApply(detailsMutation.data);
    }
  };

  return (
    <Modal opened onClose={onClose} title={t("metadataSearch.title")} size="lg" centered>
      {selected ? (
        <Stack gap="sm">
          <Anchor component="button" type="button" size="sm" onClick={() => setSelected(null)}>
            <Group gap={4}>
              <IconArrowLeft size={14} />
              {t("metadataSearch.backToResults")}
            </Group>
          </Anchor>

          {detailsMutation.isPending && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {detailsMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {detailsMutation.error instanceof Error ? detailsMutation.error.message : String(detailsMutation.error)}
            </Alert>
          )}

          {detailsMutation.data && (
            <Stack gap={4}>
              <Text fw={700} size="lg">
                {detailsMutation.data.title}
              </Text>
              <Text c="dimmed">{detailsMutation.data.authors.join(", ") || t("common.unknownAuthor")}</Text>
              {detailsMutation.data.publisher && (
                <Text size="sm">
                  {t("bookEdit.publisher")}: {detailsMutation.data.publisher}
                </Text>
              )}
              {detailsMutation.data.publishedDate && (
                <Text size="sm">
                  {t("bookEdit.publishedDate")}: {detailsMutation.data.publishedDate}
                </Text>
              )}
              {detailsMutation.data.description && (
                <Text size="sm" c="dimmed" lineClamp={6} mt="xs">
                  {detailsMutation.data.description}
                </Text>
              )}

              <Group justify="flex-end" mt="md">
                <Button variant="default" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={handleApply}>{t("metadataSearch.apply")}</Button>
              </Group>
            </Stack>
          )}
        </Stack>
      ) : (
        <Stack gap="sm">
          <form onSubmit={handleSearch}>
            <Group gap="xs" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                placeholder={t("metadataSearch.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                leftSection={<IconSearch size={15} />}
                autoFocus
              />
              <ActionIcon type="submit" variant="filled" size="lg" loading={searchMutation.isPending} aria-label={t("metadataSearch.search")}>
                <IconSearch size={16} />
              </ActionIcon>
            </Group>
          </form>

          {searchMutation.isPending && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {searchMutation.isError && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {searchMutation.error instanceof Error ? searchMutation.error.message : String(searchMutation.error)}
            </Alert>
          )}

          {searchMutation.data && searchMutation.data.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("metadataSearch.noResults")}
            </Text>
          )}

          {searchMutation.data && searchMutation.data.length > 0 && (
            <ScrollArea.Autosize mah={420}>
              <Stack gap={4}>
                {searchMutation.data.map((result) => (
                  <UnstyledButton
                    key={result.key}
                    onClick={() => handleSelect(result)}
                    p="xs"
                    style={{ borderRadius: "var(--mantine-radius-sm)", display: "flex", gap: 12 }}
                  >
                    {result.coverUrl ? (
                      <Image src={result.coverUrl} w={40} h={56} fit="cover" radius="sm" style={{ flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 40, height: 56, flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {result.title}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {result.authors.join(", ") || t("common.unknownAuthor")}
                        {result.firstPublishYear ? ` · ${result.firstPublishYear}` : ""}
                      </Text>
                    </div>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}
    </Modal>
  );
}

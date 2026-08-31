import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Avatar, Badge, Box, FileButton, Group, NavLink, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconPencil, IconSearch, IconTrash, IconUser, IconX } from "../icons";
import { authorImageUrl, deleteAuthorImage, listAuthors, renameAuthor, uploadAuthorImage, type BrowseGroup } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { BrowseViewHeader } from "./BrowseViewHeader";
import type { GroupFilter } from "./Sidebar";

interface AuthorsViewProps {
  onSelect: (filter: GroupFilter) => void;
  onBack: () => void;
}

interface AuthorAvatarProps {
  author: BrowseGroup;
  onUpload: (file: File) => void;
  onDelete: () => void;
  uploading: boolean;
}

function AuthorAvatar({ author, onUpload, onDelete, uploading }: AuthorAvatarProps) {
  const { t } = useLanguage();

  return (
    <Group gap={2} wrap="nowrap">
      <FileButton onChange={(file) => file && onUpload(file)} accept="image/jpeg,image/png">
        {(props) => (
          <Tooltip label={t("authorsView.uploadImage")}>
            <Avatar {...props} src={author.hasImage ? authorImageUrl(author.id) : null} radius="xl" style={{ cursor: "pointer" }}>
              <IconUser size={16} />
            </Avatar>
          </Tooltip>
        )}
      </FileButton>
      {author.hasImage && (
        <Tooltip label={t("authorsView.removeImage")}>
          <ActionIcon variant="subtle" color="red" size="sm" loading={uploading} onClick={onDelete} aria-label={t("authorsView.removeImage")}>
            <IconTrash size={12} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

export function AuthorsView({ onSelect, onBack }: AuthorsViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const authorsQuery = useQuery({ queryKey: ["authors"], queryFn: listAuthors });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameAuthor(id, name),
    onSuccess: () => {
      setEditingId(null);
      setRenameError(null);
      void queryClient.invalidateQueries({ queryKey: ["authors"] });
      // Book cards/detail show author names directly, so a rename needs those refreshed too.
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      void queryClient.invalidateQueries({ queryKey: ["book"] });
    },
    onError: (err) => setRenameError(err instanceof Error ? err.message : String(err)),
  });

  // Issue #28: an uploadable author photo, shown as an avatar next to each row - a bump on
  // hasImage's cache-busting param isn't needed since the id-keyed URL only ever changes what
  // file it resolves to server-side, and the query invalidation below refetches the row anyway.
  const imageMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadAuthorImage(id, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["authors"] }),
  });

  const deleteImageMutation = useMutation({
    mutationFn: (id: string) => deleteAuthorImage(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["authors"] }),
  });

  const startEditing = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
    setRenameError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setRenameError(null);
  };

  const commitEditing = () => {
    const trimmed = editValue.trim();
    if (editingId && trimmed.length > 0) {
      renameMutation.mutate({ id: editingId, name: trimmed });
    }
  };

  const filtered = useMemo(() => {
    // The "unknown author" sentinel (id "unknown", see Sidebar.tsx and issue #41) isn't a real
    // Author row - it has no name to rename and no image to upload - so this management screen
    // only lists it via the sidebar's own Authors group, not here.
    const authors = (authorsQuery.data ?? []).filter((a) => a.id !== "unknown");
    const term = search.trim().toLowerCase();
    const matched = term ? authors.filter((a) => a.name.toLowerCase().includes(term)) : authors;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [authorsQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("authorsView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <TextInput
          mb="md"
          placeholder={t("authorsView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        {renameError && (
          <Text size="xs" c="red" mb="xs">
            {renameError}
          </Text>
        )}

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("authorsView.empty")}
            </Text>
          )}

          {filtered.map((author) =>
            editingId === author.id ? (
              <Group key={author.id} gap={4} wrap="nowrap" px="sm" py={4}>
                <AuthorAvatar
                  author={author}
                  onUpload={(file) => imageMutation.mutate({ id: author.id, file })}
                  onDelete={() => deleteImageMutation.mutate(author.id)}
                  uploading={imageMutation.isPending || deleteImageMutation.isPending}
                />
                <TextInput
                  size="xs"
                  style={{ flex: 1 }}
                  value={editValue}
                  autoFocus
                  onChange={(e) => setEditValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditing();
                    if (e.key === "Escape") cancelEditing();
                  }}
                />
                <ActionIcon
                  variant="subtle"
                  color="green"
                  loading={renameMutation.isPending}
                  disabled={editValue.trim().length === 0}
                  onClick={commitEditing}
                  aria-label={t("common.save")}
                >
                  <IconCheck size={15} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" onClick={cancelEditing} aria-label={t("common.cancel")}>
                  <IconX size={15} />
                </ActionIcon>
              </Group>
            ) : (
              <Group key={author.id} gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <AuthorAvatar
                  author={author}
                  onUpload={(file) => imageMutation.mutate({ id: author.id, file })}
                  onDelete={() => deleteImageMutation.mutate(author.id)}
                  uploading={imageMutation.isPending || deleteImageMutation.isPending}
                />
                <NavLink
                  label={author.name}
                  onClick={() => {
                    onSelect({ kind: "authorId", id: author.id, name: author.name });
                    onBack();
                  }}
                  rightSection={
                    <Badge size="sm" variant="light" color="gray">
                      {author.bookCount}
                    </Badge>
                  }
                  style={{ flex: 1 }}
                  px="sm"
                  py={7}
                  styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                />
                <Tooltip label={t("authorsView.rename")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => startEditing(author.id, author.name)}
                    aria-label={t("authorsView.rename")}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          )}
        </Stack>
      </Box>
    </Box>
  );
}

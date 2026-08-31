import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Progress,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBooks,
  IconCheck,
  IconFolderOpen,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "../icons";
import {
  listLibraries,
  openLibrary,
  openLibraryById,
  relocateLibrary,
  removeLibrary,
  renameLibrary,
  setLibraryPeriodicalsEnabled,
  type LibraryEntry,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";
import { useRescan } from "../RescanContext";

interface LibrariesSettingsProps {
  // Called whenever the ACTIVE library's identity or contents actually changed (switched to a
  // different one, or the active one was relocated/removed/resynced) - not for actions on other,
  // inactive rows (rename, relocate, resync, remove), which don't affect what's currently shown.
  onActiveLibraryChanged: () => void;
}

export function LibrariesSettings({ onActiveLibraryChanged }: LibrariesSettingsProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const librariesQuery = useQuery({ queryKey: ["libraries"], queryFn: listLibraries });

  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const rescan = useRescan();

  const [actionError, setActionError] = useState<string | null>(null);

  const invalidateLibraries = () => void queryClient.invalidateQueries({ queryKey: ["libraries"] });

  const refreshActiveLibrary = () => {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    invalidateLibraryQueries(queryClient);
    onActiveLibraryChanged();
  };

  const handleAdd = async () => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) {
      return;
    }

    setAddBusy(true);
    setAddError(null);
    try {
      await openLibrary(folder);
      invalidateLibraries();
      refreshActiveLibrary();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  };

  const switchMutation = useMutation({
    mutationFn: (id: string) => openLibraryById(id),
    onSuccess: () => {
      invalidateLibraries();
      refreshActiveLibrary();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameLibrary(id, name),
    onSuccess: () => {
      setRenamingId(null);
      invalidateLibraries();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const relocateMutation = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => relocateLibrary(id, path),
    onSuccess: (_result, { id }) => {
      invalidateLibraries();
      if (librariesQuery.data?.find((l) => l.id === id)?.isActive) {
        refreshActiveLibrary();
      }
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const periodicalsToggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setLibraryPeriodicalsEnabled(id, enabled),
    onSuccess: (_result, { id }) => {
      invalidateLibraries();
      // Sidebar/BookEditForm read this off the ["library"] query (the active library only) - only
      // worth refreshing when the toggled row actually is the active one.
      if (librariesQuery.data?.find((l) => l.id === id)?.isActive) {
        void queryClient.invalidateQueries({ queryKey: ["library"] });
      }
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeLibrary(id),
    onSuccess: (_result, id) => {
      setConfirmingRemoveId(null);
      const wasActive = librariesQuery.data?.find((l) => l.id === id)?.isActive ?? false;
      invalidateLibraries();
      if (wasActive) {
        refreshActiveLibrary();
      }
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : String(err)),
  });

  const handleRelocate = async (id: string) => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) {
      return;
    }
    relocateMutation.mutate({ id, path: folder });
  };

  const handleResync = (entry: LibraryEntry) => {
    setActionError(null);
    // Runs via RescanContext (mounted at the app root) rather than local state, so the resync - and
    // its progress - survives this Settings modal being closed before it finishes; see
    // RescanContext.tsx and RescanStatusBar.tsx.
    rescan.start({ id: entry.id, name: entry.name, isActive: entry.isActive }, refreshActiveLibrary);
  };

  const startRename = (entry: LibraryEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  };

  const confirmRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      return;
    }
    renameMutation.mutate({ id, name: trimmed });
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t("librariesSettings.description")}
        </Text>
        <Button size="sm" leftSection={<IconPlus size={14} />} onClick={() => void handleAdd()} loading={addBusy}>
          {t("librariesSettings.addLibrary")}
        </Button>
      </Group>

      {addError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("settings.changeLibraryErrorTitle")}>
          {addError}
        </Alert>
      )}

      {actionError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} onClose={() => setActionError(null)} withCloseButton>
          {actionError}
        </Alert>
      )}

      {rescan.error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} onClose={rescan.dismissError} withCloseButton>
          {rescan.error}
        </Alert>
      )}

      {librariesQuery.data?.length === 0 && (
        <Text size="sm" c="dimmed">
          {t("librariesSettings.empty")}
        </Text>
      )}

      <Stack gap="xs">
        {librariesQuery.data?.map((entry) => (
          <Stack
            key={entry.id}
            gap={6}
            p="sm"
            style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: "var(--mantine-radius-sm)" }}
          >
            <Group justify="space-between" wrap="nowrap">
              {renamingId === entry.id ? (
                <Group gap={4} style={{ flex: 1 }} wrap="nowrap">
                  <TextInput
                    size="xs"
                    style={{ flex: 1 }}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename(entry.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    autoFocus
                  />
                  <ActionIcon
                    variant="subtle"
                    color="green"
                    loading={renameMutation.isPending}
                    onClick={() => confirmRename(entry.id)}
                    aria-label={t("common.confirm")}
                  >
                    <IconCheck size={14} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" onClick={() => setRenamingId(null)} aria-label={t("common.cancel")}>
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              ) : (
                <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <IconBooks size={15} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <Text size="sm" fw={600} truncate="end">
                    {entry.name}
                  </Text>
                  {entry.isActive && (
                    <Badge size="xs" variant="light">
                      {t("librariesSettings.active")}
                    </Badge>
                  )}
                </Group>
              )}

              <Group gap={4} wrap="nowrap">
                {!entry.isActive && (
                  <Button
                    size="xs"
                    variant="default"
                    loading={switchMutation.isPending && switchMutation.variables === entry.id}
                    onClick={() => switchMutation.mutate(entry.id)}
                  >
                    {t("librariesSettings.open")}
                  </Button>
                )}
                <Tooltip label={t("librariesSettings.rename")}>
                  <ActionIcon variant="subtle" color="gray" onClick={() => startRename(entry)} aria-label={t("librariesSettings.rename")}>
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={t("librariesSettings.changeFolder")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => void handleRelocate(entry.id)}
                    aria-label={t("librariesSettings.changeFolder")}
                  >
                    <IconFolderOpen size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={t("librariesSettings.resync")}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    loading={rescan.libraryId === entry.id}
                    disabled={rescan.isRunning && rescan.libraryId !== entry.id}
                    onClick={() => handleResync(entry)}
                    aria-label={t("librariesSettings.resync")}
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
                {confirmingRemoveId === entry.id ? (
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" color="red" loading={removeMutation.isPending} onClick={() => removeMutation.mutate(entry.id)}>
                      {t("common.confirm")}
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => setConfirmingRemoveId(null)}>
                      {t("common.cancel")}
                    </Button>
                  </Group>
                ) : (
                  <Tooltip label={t("librariesSettings.remove")}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => setConfirmingRemoveId(entry.id)}
                      aria-label={t("librariesSettings.remove")}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            </Group>

            <Text size="xs" c="dimmed" ff="var(--mantine-font-family-monospace)" truncate="end">
              {entry.path}
            </Text>

            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("librariesSettings.periodicals")}
              </Text>
              <Switch
                size="xs"
                checked={entry.periodicalsEnabled}
                disabled={periodicalsToggleMutation.isPending && periodicalsToggleMutation.variables?.id === entry.id}
                onChange={(e) => periodicalsToggleMutation.mutate({ id: entry.id, enabled: e.currentTarget.checked })}
              />
            </Group>

            {rescan.libraryId === entry.id && (
              <Stack gap={2}>
                <Progress
                  size="xs"
                  value={rescan.progress && rescan.progress.total > 0 ? (rescan.progress.processed / rescan.progress.total) * 100 : 0}
                  animated={!rescan.progress?.total}
                />
                <Text size="xs" c="dimmed">
                  {rescan.progress && rescan.progress.total > 0
                    ? t("settings.rescanProgress", { processed: rescan.progress.processed, total: rescan.progress.total })
                    : t("settings.rescanStarting")}
                </Text>
              </Stack>
            )}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

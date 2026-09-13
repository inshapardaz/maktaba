import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
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
  IconCloud,
  IconCloudUpload,
  IconFolderOpen,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "../icons";
import {
  connectCloudLibrary,
  listLibraries,
  openLibrary,
  openLibraryById,
  relocateLibrary,
  removeLibrary,
  renameLibrary,
  reopenCloudLibrary,
  setLibraryPeriodicalsEnabled,
  testS3Connection,
  type LibraryEntry,
  type S3Credential,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";
import { useRescan } from "../RescanContext";
import { useLibrarySync } from "../LibrarySyncContext";
import { EMPTY_S3_FIELDS, isS3FieldsComplete, S3CredentialFields, type S3FieldsValue } from "./S3CredentialFields";
import { MigrationWizard } from "./MigrationWizard";

// Provider names are proper nouns/brand names, not translated - same convention as file format
// labels (EPUB/PDF/...) elsewhere in this app. Only "local" is reachable today; the rest land with
// their own phases (S3 first).
const PROVIDER_LABELS: Record<string, string> = {
  s3: "Amazon S3",
  onedrive: "OneDrive",
  googledrive: "Google Drive",
  nawishta: "Nawishta",
};

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
  const librarySync = useLibrarySync();

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

  const [s3ModalOpen, setS3ModalOpen] = useState(false);
  const [migratingLibraryId, setMigratingLibraryId] = useState<string | null>(null);
  const [reconnectingEntry, setReconnectingEntry] = useState<LibraryEntry | null>(null);

  const handleS3Connected = () => {
    setS3ModalOpen(false);
    invalidateLibraries();
    refreshActiveLibrary();
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t("librariesSettings.description")}
        </Text>
        <Group gap="xs">
          <Button size="sm" variant="default" leftSection={<IconCloud size={14} />} onClick={() => setS3ModalOpen(true)}>
            {t("librariesSettings.connectS3")}
          </Button>
          <Button size="sm" leftSection={<IconPlus size={14} />} onClick={() => void handleAdd()} loading={addBusy}>
            {t("librariesSettings.addLibrary")}
          </Button>
        </Group>
      </Group>

      <S3ConnectModal opened={s3ModalOpen} onClose={() => setS3ModalOpen(false)} onConnected={handleS3Connected} />
      <MigrationWizard
        opened={migratingLibraryId !== null}
        libraryId={migratingLibraryId ?? ""}
        onClose={() => setMigratingLibraryId(null)}
        onActiveLibraryChanged={() => {
          invalidateLibraries();
          refreshActiveLibrary();
        }}
      />
      <ReconnectModal
        entry={reconnectingEntry}
        onClose={() => setReconnectingEntry(null)}
        onReconnected={() => {
          setReconnectingEntry(null);
          invalidateLibraries();
          refreshActiveLibrary();
        }}
      />

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
                  {entry.providerType !== "local" && (
                    <Badge size="xs" variant="outline" color="gray">
                      {PROVIDER_LABELS[entry.providerType] ?? entry.providerType}
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
                {entry.providerType === "local" && (
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
                )}
                {entry.providerType === "local" && (
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
                )}
                {entry.isActive && entry.providerType === "local" && (
                  <Tooltip label={t("librariesSettings.migrateToCloud")}>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setMigratingLibraryId(entry.id)}
                      aria-label={t("librariesSettings.migrateToCloud")}
                    >
                      <IconCloud size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
                {entry.isActive && entry.providerType !== "local" && (
                  <Tooltip label={t("librariesSettings.syncNow")}>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      loading={librarySync.isSyncing}
                      onClick={librarySync.requestSync}
                      aria-label={t("librariesSettings.syncNow")}
                    >
                      <IconCloudUpload size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
                {entry.providerType !== "local" && (
                  <Tooltip label={t("librariesSettings.reconnect")}>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setReconnectingEntry(entry)}
                      aria-label={t("librariesSettings.reconnect")}
                    >
                      <IconKey size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
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

interface S3ConnectModalProps {
  opened: boolean;
  onClose: () => void;
  onConnected: () => void;
}

// Amazon S3 connect form (Cloud: Phase 2) - Test connection verifies the bucket/region/credentials
// work before Connect commits to registering a library against them. On success, the credential is
// saved encrypted (window.maktaba.saveCloudCredential, keyed by the new library's own id - see
// LibraryService.OpenCloudLibraryAsync's CredentialRef) so a later app launch can re-supply it
// without asking the user to retype it every time.
function S3ConnectModal({ opened, onClose, onConnected }: S3ConnectModalProps) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [fields, setFields] = useState<S3FieldsValue>(EMPTY_S3_FIELDS);
  const [testResult, setTestResult] = useState<"success" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credential: S3Credential = { accessKeyId: fields.accessKeyId, secretAccessKey: fields.secretAccessKey };
  const canSubmit = name.trim().length > 0 && isS3FieldsComplete(fields);

  const testMutation = useMutation({
    mutationFn: () => testS3Connection(fields.bucket.trim(), fields.region.trim(), fields.prefix.trim(), credential, fields.endpoint.trim()),
    onSuccess: () => {
      setTestResult("success");
      setError(null);
    },
    onError: (err) => {
      setTestResult(null);
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const providerConfig: Record<string, string> = {
        bucket: fields.bucket.trim(), region: fields.region.trim(), prefix: fields.prefix.trim(),
      };
      if (fields.endpoint.trim()) {
        providerConfig.endpoint = fields.endpoint.trim();
      }
      const entry = await connectCloudLibrary(name.trim(), "s3", providerConfig, credential);
      await window.maktaba.saveCloudCredential(entry.id, JSON.stringify(credential));
      return entry;
    },
    onSuccess: () => {
      reset();
      onConnected();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const reset = () => {
    setName("");
    setFields(EMPTY_S3_FIELDS);
    setTestResult(null);
    setError(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("librariesSettings.connectS3")}
    >
      <Stack gap="sm">
        <TextInput
          label={t("librariesSettings.s3Name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <S3CredentialFields value={fields} onChange={(patch) => setFields((prev) => ({ ...prev, ...patch }))} />

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        {testResult === "success" && (
          <Alert color="green" icon={<IconCheck size={18} />}>
            {t("librariesSettings.s3TestSuccess")}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={!canSubmit}
            loading={testMutation.isPending}
            onClick={() => testMutation.mutate()}
          >
            {t("librariesSettings.s3TestConnection")}
          </Button>
          <Button disabled={!canSubmit} loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
            {t("librariesSettings.s3Connect")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface ReconnectModalProps {
  // null = closed. Kept as the whole entry (not just an id) so the modal can show the library's
  // name without a separate lookup, and so closing it doesn't need to clear a second piece of state.
  entry: LibraryEntry | null;
  onClose: () => void;
  onReconnected: () => void;
}

// Re-supplies an already-registered cloud library's credential - needed after rotating an access
// key with the storage provider, or to recover a library whose saved credential is missing/invalid
// (see docs/en/libraries.md's "If a cloud library won't reconnect"). Unlike S3ConnectModal, this
// only asks for the access key/secret - bucket/region/prefix/endpoint are already on the registry
// entry and aren't being changed here.
function ReconnectModal({ entry, onClose, onReconnected }: ReconnectModalProps) {
  const { t } = useLanguage();
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAccessKeyId("");
    setSecretAccessKey("");
    setError(null);
  };

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      if (!entry) {
        return;
      }
      const credential: S3Credential = { accessKeyId, secretAccessKey };
      await reopenCloudLibrary(entry.id, credential);
      await window.maktaba.saveCloudCredential(entry.id, JSON.stringify(credential));
    },
    onSuccess: () => {
      reset();
      onReconnected();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const canSubmit = accessKeyId.trim().length > 0 && secretAccessKey.length > 0;

  return (
    <Modal
      opened={entry !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={entry ? t("librariesSettings.reconnectTitle", { name: entry.name }) : ""}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("librariesSettings.reconnectDescription")}
        </Text>
        <TextInput
          label={t("librariesSettings.s3AccessKey")}
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.currentTarget.value)}
        />
        <PasswordInput
          label={t("librariesSettings.s3SecretKey")}
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.currentTarget.value)}
        />

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button disabled={!canSubmit} loading={reconnectMutation.isPending} onClick={() => reconnectMutation.mutate()}>
            {t("librariesSettings.reconnectButton")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

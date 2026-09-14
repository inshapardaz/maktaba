import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Group, Modal, Progress, SegmentedControl, Stack, Stepper, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconExternalLink } from "../icons";
import {
  cancelMigration,
  completeMigration,
  previewMigration,
  startMigration,
  getMigrationStatus,
  testS3Connection,
  type GoogleDriveCredential,
  type S3Credential,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";
import { PROVIDER_LABELS } from "./LibrariesSettings";
import { PROVIDER_ICONS } from "./providerIcons";
import { EMPTY_S3_FIELDS, isS3FieldsComplete, S3CredentialFields, type S3FieldsValue } from "./S3CredentialFields";

// Migration targets this wizard can drive today - a subset of every registered ProviderType
// (StorageProviderFactory/the backend's /migrate/start endpoint are already provider-agnostic, see
// MigrationTarget). OneDrive is left out for now: it needs a real Azure AD app registration first
// (see CLAUDE.md's walkthrough) and isn't reachable from the Connect UI yet either - add it here
// the same way Google Drive was added below once that's sorted, rather than exposing a target that
// would only fail immediately.
type MigrationProvider = "s3" | "googledrive";

interface MigrationWizardProps {
  opened: boolean;
  // The library being migrated - needed to save its cloud credential under the right ref once the
  // migration completes (see completeMutation below). Ignored while opened is false.
  libraryId: string;
  onClose: () => void;
  // Same "the active library's identity changed" callback LibrariesSettings.tsx already uses -
  // migration always operates on the active library, and finishing one changes its provider.
  onActiveLibraryChanged: () => void;
}

// Mantine Stepper flow (Cloud: Phase 3, extended in Phase 5+ for a target provider picker) - the
// Target step reuses the same fields/sign-in flow each provider's own Connect form uses
// (S3CredentialFields, or Google's sign-in button) since a migration target is configured exactly
// the same way a fresh cloud library connection is, just without a name (the library keeps its
// existing one).
export function MigrationWizard({ opened, libraryId, onClose, onActiveLibraryChanged }: MigrationWizardProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<MigrationProvider>("s3");
  const [fields, setFields] = useState<S3FieldsValue>(EMPTY_S3_FIELDS);
  const [testResult, setTestResult] = useState<"success" | null>(null);
  const [googleFolder, setGoogleFolder] = useState("");
  const [googleTokens, setGoogleTokens] = useState<GoogleDriveCredential | null>(null);
  const [deleteSource, setDeleteSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s3Credential: S3Credential = { accessKeyId: fields.accessKeyId, secretAccessKey: fields.secretAccessKey };
  const credential: S3Credential | GoogleDriveCredential = provider === "googledrive" ? (googleTokens ?? s3Credential) : s3Credential;
  const canSubmit = provider === "googledrive" ? googleTokens !== null : isS3FieldsComplete(fields);

  const reset = () => {
    setStep(0);
    setProvider("s3");
    setFields(EMPTY_S3_FIELDS);
    setTestResult(null);
    setGoogleFolder("");
    setGoogleTokens(null);
    setDeleteSource(false);
    setError(null);
  };

  const googleSignInMutation = useMutation({
    mutationFn: () => window.maktaba.connectGoogleDrive(),
    onSuccess: (result) => {
      setGoogleTokens(result);
      setError(null);
    },
    onError: (err) => {
      setGoogleTokens(null);
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const cancelPendingGoogleSignIn = () => {
    if (googleSignInMutation.isPending) {
      void window.maktaba.cancelGoogleDriveConnect();
    }
  };

  const handleClose = () => {
    // Deliberately doesn't cancel an in-flight migration just because the wizard was closed - the
    // backend keeps running it in the background (same reasoning as RescanContext surviving
    // Settings closing), so reopening the wizard would pick the status back up. Only reset the
    // wizard's own local state (which step it's showing, the form) once it's genuinely idle.
    cancelPendingGoogleSignIn();
    if (step !== 2) {
      reset();
    }
    onClose();
  };

  const testMutation = useMutation({
    mutationFn: () => testS3Connection(fields.bucket.trim(), fields.region.trim(), fields.prefix.trim(), s3Credential, fields.endpoint.trim()),
    onSuccess: () => {
      setTestResult("success");
      setError(null);
    },
    onError: (err) => {
      setTestResult(null);
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const previewQuery = useQuery({
    queryKey: ["migrationPreview"],
    queryFn: previewMigration,
    enabled: opened && step === 1,
  });

  const startMutation = useMutation({
    mutationFn: () => {
      if (provider === "googledrive") {
        const providerConfig: Record<string, string> = {};
        if (googleFolder.trim()) {
          providerConfig.folder = googleFolder.trim();
        }
        return startMigration("googledrive", providerConfig, credential);
      }

      const providerConfig: Record<string, string> = {
        bucket: fields.bucket.trim(), region: fields.region.trim(), prefix: fields.prefix.trim(),
      };
      if (fields.endpoint.trim()) {
        providerConfig.endpoint = fields.endpoint.trim();
      }
      return startMigration("s3", providerConfig, credential);
    },
    onSuccess: () => {
      setError(null);
      setStep(2);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const statusQuery = useQuery({
    queryKey: ["migrationStatus"],
    queryFn: getMigrationStatus,
    enabled: opened && step === 2,
    refetchInterval: opened && step === 2 ? 800 : false,
  });

  useEffect(() => {
    if (statusQuery.data?.state === "Verified") {
      setStep(3);
    }
  }, [statusQuery.data?.state]);

  const cancelMutation = useMutation({ mutationFn: cancelMigration });

  const completeMutation = useMutation({
    mutationFn: async () => {
      await completeMigration(deleteSource);
      // Same as S3ConnectModal's/GoogleDriveConnectModal's connect flow - the backend only ever
      // holds this credential transiently (cleared every restart, see ICloudCredentialCache), so
      // without saving it here too, the very next app startup's cloudReconnectQuery finds nothing
      // to reconnect this library with.
      await window.maktaba.saveCloudCredential(libraryId, JSON.stringify(credential));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["libraries"] });
      invalidateLibraryQueries(queryClient);
      onActiveLibraryChanged();
      reset();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const status = statusQuery.data;
  const failed = status?.state === "Failed";
  const cancelled = status?.state === "Cancelled";

  return (
    <Modal opened={opened} onClose={handleClose} title={t("migrationWizard.title")} size="lg" centered>
      <Stepper active={step} onStepClick={undefined} allowNextStepsSelect={false}>
        <Stepper.Step label={t("migrationWizard.stepTarget")}>
          <Stack gap="sm" pt="sm">
            <Text size="sm" c="dimmed">
              {t("migrationWizard.targetDescription")}
            </Text>

            <SegmentedControl
              value={provider}
              onChange={(value) => {
                cancelPendingGoogleSignIn();
                setProvider(value as MigrationProvider);
                setTestResult(null);
                setError(null);
              }}
              data={(["s3", "googledrive"] as MigrationProvider[]).map((value) => ({
                value,
                label: (
                  <Group gap={6} wrap="nowrap">
                    {(() => {
                      const Icon = PROVIDER_ICONS[value];
                      return <Icon size={14} />;
                    })()}
                    <span>{PROVIDER_LABELS[value]}</span>
                  </Group>
                ),
              }))}
            />

            {provider === "s3" ? (
              <>
                <S3CredentialFields value={fields} onChange={(patch) => setFields((prev) => ({ ...prev, ...patch }))} />
                {testResult === "success" && (
                  <Alert color="green" icon={<IconCheck size={18} />}>
                    {t("librariesSettings.s3TestSuccess")}
                  </Alert>
                )}
              </>
            ) : (
              <>
                <TextInput
                  label={t("librariesSettings.googleDriveFolder")}
                  placeholder={t("librariesSettings.googleDriveFolderPlaceholder")}
                  value={googleFolder}
                  onChange={(e) => setGoogleFolder(e.currentTarget.value)}
                />
                {googleTokens ? (
                  <Alert color="green" icon={<IconCheck size={18} />}>
                    {t("librariesSettings.googleDriveSignedIn")}
                  </Alert>
                ) : googleSignInMutation.isPending ? (
                  <Group gap="xs">
                    <Button variant="default" leftSection={<IconExternalLink size={14} />} loading style={{ flex: 1 }}>
                      {t("librariesSettings.googleDriveSignIn")}
                    </Button>
                    <Button variant="subtle" color="red" onClick={cancelPendingGoogleSignIn}>
                      {t("common.cancel")}
                    </Button>
                  </Group>
                ) : (
                  <Button
                    variant="default"
                    leftSection={<IconExternalLink size={14} />}
                    onClick={() => googleSignInMutation.mutate()}
                  >
                    {t("librariesSettings.googleDriveSignIn")}
                  </Button>
                )}
              </>
            )}

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}

            <Group justify="flex-end">
              {provider === "s3" && (
                <Button variant="default" disabled={!canSubmit} loading={testMutation.isPending} onClick={() => testMutation.mutate()}>
                  {t("librariesSettings.s3TestConnection")}
                </Button>
              )}
              <Button disabled={!canSubmit} onClick={() => setStep(1)}>
                {t("migrationWizard.next")}
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("migrationWizard.stepReview")}>
          <Stack gap="sm" pt="sm">
            {previewQuery.isLoading ? (
              <Text size="sm" c="dimmed">
                {t("migrationWizard.counting")}
              </Text>
            ) : previewQuery.data ? (
              <Text size="sm">{t("migrationWizard.fileCount", { count: previewQuery.data.fileCount })}</Text>
            ) : null}
            <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
              {t("migrationWizard.reviewWarning")}
            </Alert>

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}

            <Group justify="space-between">
              <Button variant="default" onClick={() => setStep(0)}>
                {t("migrationWizard.back")}
              </Button>
              <Button loading={startMutation.isPending} onClick={() => startMutation.mutate()}>
                {t("migrationWizard.startMigration")}
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("migrationWizard.stepMigrate")}>
          <Stack gap="sm" pt="sm">
            <Progress
              size="lg"
              value={status && status.total > 0 ? (status.processed / status.total) * 100 : 0}
              animated={!status?.total}
              color={failed ? "red" : cancelled ? "gray" : undefined}
            />
            <Text size="sm" c="dimmed">
              {status?.total
                ? t("migrationWizard.progress", { processed: status.processed, total: status.total })
                : t("migrationWizard.starting")}
            </Text>
            {status?.currentFile && (
              <Text size="xs" c="dimmed" truncate="end">
                {status.currentFile}
              </Text>
            )}

            {failed && (
              <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("migrationWizard.failedTitle")}>
                {status?.errorMessage}
              </Alert>
            )}
            {cancelled && (
              <Alert color="gray" icon={<IconAlertCircle size={18} />}>
                {t("migrationWizard.cancelledMessage")}
              </Alert>
            )}

            <Group justify="space-between">
              {failed || cancelled ? (
                <Button variant="default" onClick={() => setStep(1)}>
                  {t("migrationWizard.tryAgain")}
                </Button>
              ) : (
                <Button variant="default" color="red" loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
                  {t("migrationWizard.cancel")}
                </Button>
              )}
              <span />
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("migrationWizard.stepFinish")}>
          <Stack gap="sm" pt="sm">
            <Alert color="green" icon={<IconCheck size={18} />}>
              {t("migrationWizard.verifiedMessage")}
            </Alert>
            <Checkbox
              checked={deleteSource}
              onChange={(e) => setDeleteSource(e.currentTarget.checked)}
              label={t("migrationWizard.deleteSourceLabel")}
              description={t("migrationWizard.deleteSourceDescription")}
            />

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            )}

            <Group justify="flex-end">
              <Button loading={completeMutation.isPending} onClick={() => completeMutation.mutate()}>
                {t("migrationWizard.finish")}
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
      </Stepper>
    </Modal>
  );
}

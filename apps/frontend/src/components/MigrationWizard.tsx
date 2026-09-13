import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Group, Modal, Progress, Stack, Stepper, Text } from "@mantine/core";
import { IconAlertCircle, IconCheck } from "../icons";
import {
  cancelMigration,
  completeMigration,
  previewMigration,
  startMigration,
  getMigrationStatus,
  testS3Connection,
  type S3Credential,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";
import { EMPTY_S3_FIELDS, isS3FieldsComplete, S3CredentialFields, type S3FieldsValue } from "./S3CredentialFields";

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

// Mantine Stepper flow (Cloud: Phase 3) - reuses S3CredentialFields (the same six inputs the S3
// connect form uses) since a migration target is configured exactly the same way a fresh cloud
// library connection is, just without a name (the library keeps its existing one).
export function MigrationWizard({ opened, libraryId, onClose, onActiveLibraryChanged }: MigrationWizardProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<S3FieldsValue>(EMPTY_S3_FIELDS);
  const [testResult, setTestResult] = useState<"success" | null>(null);
  const [deleteSource, setDeleteSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const credential: S3Credential = { accessKeyId: fields.accessKeyId, secretAccessKey: fields.secretAccessKey };
  const canSubmit = isS3FieldsComplete(fields);

  const reset = () => {
    setStep(0);
    setFields(EMPTY_S3_FIELDS);
    setTestResult(null);
    setDeleteSource(false);
    setError(null);
  };

  const handleClose = () => {
    // Deliberately doesn't cancel an in-flight migration just because the wizard was closed - the
    // backend keeps running it in the background (same reasoning as RescanContext surviving
    // Settings closing), so reopening the wizard would pick the status back up. Only reset the
    // wizard's own local state (which step it's showing, the form) once it's genuinely idle.
    if (step !== 2) {
      reset();
    }
    onClose();
  };

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

  const previewQuery = useQuery({
    queryKey: ["migrationPreview"],
    queryFn: previewMigration,
    enabled: opened && step === 1,
  });

  const startMutation = useMutation({
    mutationFn: () => {
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
      // Same as S3ConnectModal's connect flow - the backend only ever holds this credential
      // transiently (cleared every restart, see ICloudCredentialCache), so without saving it here
      // too, the very next app startup's cloudReconnectQuery finds nothing to reconnect this
      // library with.
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
              <Button variant="default" disabled={!canSubmit} loading={testMutation.isPending} onClick={() => testMutation.mutate()}>
                {t("librariesSettings.s3TestConnection")}
              </Button>
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

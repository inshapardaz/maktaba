import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Button, Group, Paper, Text } from "@mantine/core";
import { publishDigitizedBook, type PublishFormat } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconBook2, IconFileText, IconUpload } from "../icons";

const FORMATS: { format: PublishFormat; labelKey: "digitize.publishEpub" | "digitize.publishMarkdown" | "digitize.publishPdf" }[] = [
  { format: "Epub", labelKey: "digitize.publishEpub" },
  { format: "Markdown", labelKey: "digitize.publishMarkdown" },
  { format: "Pdf", labelKey: "digitize.publishPdf" },
];

// Phase 8 (epic #162) - pick an output format and publish; re-publishing the same format after
// corrections updates the existing BookFile in place rather than creating a duplicate (handled
// entirely server-side - see DigitizationPublishingService). Deliberately not gated on the "Merge
// into chapters" confirmation having run - publishing always re-merges the latest page text fresh
// (see IChapterMergeService), so an un-merged book publishes fine, just without that explicit
// checkpoint having been clicked.
export function PublishPanel({ bookId }: { bookId: string }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const publishMutation = useMutation({
    mutationFn: (format: PublishFormat) => publishDigitizedBook(bookId, format),
    onSuccess: (result) => {
      notifications.show({ color: "green", message: t("digitize.publishSucceeded", { format: result.format }) });
      void queryClient.invalidateQueries({ queryKey: ["book", bookId] });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between">
        <Text size="sm" fw={600}>{t("digitize.publish")}</Text>
        <Group gap="xs">
          {FORMATS.map(({ format, labelKey }) => (
            <Button
              key={format}
              size="xs"
              variant="light"
              leftSection={format === "Epub" ? <IconBook2 size={14} /> : format === "Pdf" ? <IconFileText size={14} /> : <IconUpload size={14} />}
              loading={publishMutation.isPending && publishMutation.variables === format}
              onClick={() => publishMutation.mutate(format)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </Group>
      </Group>
    </Paper>
  );
}

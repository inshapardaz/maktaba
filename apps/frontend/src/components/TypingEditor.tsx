import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Button, Group, Image, Modal, ScrollArea, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import {
  bulkSetPageStatus, digitizationPageImageUrl, getDigitizationPageText, runDigitizationPageOcr,
  saveDigitizationPageText, type DigitizationPageDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconArrowLeft, IconArrowRight, IconScanLine } from "../icons";

const STATUSES = ["Pending", "Typing", "Typed", "ProofRead", "Complete"];
const AUTOSAVE_DELAY_MS = 1500;

// Phase 5 (epic #162) - split-view typing editor (page image | plain Textarea, per the epic's own
// note that this control will be swapped for something richer later - kept as a thin, swappable
// surface). Text autosaves (debounced) and also flushes immediately on navigating to a different
// page, so nothing typed is lost switching pages quickly.
export function TypingEditor({
  bookId, pages, initialPageId, onClose,
}: {
  bookId: string;
  pages: DigitizationPageDto[];
  initialPageId: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const sortedPages = [...pages].sort((a, b) => a.order - b.order);
  const [index, setIndex] = useState(() => Math.max(0, sortedPages.findIndex((p) => p.id === initialPageId)));
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const page = sortedPages[index];

  const textQuery = useQuery({
    queryKey: ["digitizationPageText", bookId, page.id],
    queryFn: () => getDigitizationPageText(bookId, page.id),
  });

  useEffect(() => {
    if (textQuery.data !== undefined) {
      setText(textQuery.data);
      setDirty(false);
    }
    // Only re-sync from the server when the loaded page's own text actually arrives - typing
    // shouldn't be clobbered by an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (value: string) => saveDigitizationPageText(bookId, page.id, value),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const ocrMutation = useMutation({
    mutationFn: () => runDigitizationPageOcr(bookId, page.id),
    onSuccess: (recognizedText) => {
      setText(recognizedText);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => bulkSetPageStatus(bookId, [page.id], status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] }),
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const flushSave = (value: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveMutation.mutate(value);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    setDirty(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flushSave(value), AUTOSAVE_DELAY_MS);
  };

  const goTo = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= sortedPages.length) return;
    if (dirty) flushSave(text);
    setIndex(newIndex);
  };

  return (
    <Modal opened onClose={() => { if (dirty) flushSave(text); onClose(); }} title={t("digitize.typingEditor")} size="95%" centered>
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Button variant="default" size="xs" leftSection={<IconArrowLeft size={14} />} disabled={index === 0} onClick={() => goTo(index - 1)}>
              {t("common.previous")}
            </Button>
            <Text size="sm">{t("digitize.pageOfPages", { current: index + 1, total: sortedPages.length })}</Text>
            <Button variant="default" size="xs" rightSection={<IconArrowRight size={14} />} disabled={index === sortedPages.length - 1} onClick={() => goTo(index + 1)}>
              {t("common.next")}
            </Button>
          </Group>
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconScanLine size={14} />} loading={ocrMutation.isPending} onClick={() => ocrMutation.mutate()}>
              {t("digitize.runOcr")}
            </Button>
            <SegmentedControl size="xs" data={STATUSES} value={page.editStatus} onChange={(v) => statusMutation.mutate(v)} />
          </Group>
        </Group>

        <Group align="flex-start" wrap="nowrap" gap="md">
          <ScrollArea h="70vh" style={{ flex: 1 }}>
            <Image src={digitizationPageImageUrl(bookId, page.id)} fit="contain" />
          </ScrollArea>
          <Stack style={{ flex: 1 }} gap={4}>
            <Textarea
              value={text}
              onChange={(e) => handleTextChange(e.currentTarget.value)}
              minRows={28}
              autosize
              styles={{ input: { height: "70vh", fontFamily: "monospace" } }}
            />
            <Text size="xs" c="dimmed">
              {saveMutation.isPending ? t("common.saving") : dirty ? t("digitize.unsavedChanges") : t("digitize.saved")}
            </Text>
          </Stack>
        </Group>
      </Stack>
    </Modal>
  );
}

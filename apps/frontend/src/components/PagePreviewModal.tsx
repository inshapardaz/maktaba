import { useState } from "react";
import { Button, Center, Group, Image, Modal, Text } from "@mantine/core";
import { digitizationPageImageUrl, type DigitizationPageDto } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconArrowLeft, IconArrowRight } from "../icons";

// Large read-only page preview with prev/next navigation - separate from PageEditModal/
// TypingEditor (which are for editing) since this is purely "let me look at this page bigger."
export function PagePreviewModal({
  bookId, pages, initialPageId, onClose,
}: {
  bookId: string;
  pages: DigitizationPageDto[];
  initialPageId: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const sortedPages = [...pages].sort((a, b) => a.order - b.order);
  const [index, setIndex] = useState(() => Math.max(0, sortedPages.findIndex((p) => p.id === initialPageId)));
  const page = sortedPages[index];

  return (
    <Modal opened onClose={onClose} title={t("digitize.previewPage", { page: page.order })} size="90%" centered>
      <Center mb="sm">
        <Image src={digitizationPageImageUrl(bookId, page.id)} fit="contain" mah="75vh" />
      </Center>
      <Group justify="center" gap="md">
        <Button variant="default" leftSection={<IconArrowLeft size={14} />} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          {t("common.previous")}
        </Button>
        <Text size="sm">{t("digitize.pageOfPages", { current: index + 1, total: sortedPages.length })}</Text>
        <Button variant="default" rightSection={<IconArrowRight size={14} />} disabled={index === sortedPages.length - 1} onClick={() => setIndex((i) => i + 1)}>
          {t("common.next")}
        </Button>
      </Group>
    </Modal>
  );
}

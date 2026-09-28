import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Button, Group, Image, Modal, NumberInput, Slider, Stack, Tabs, Text } from "@mantine/core";
import {
  cropDigitizationPage, digitizationPageImageUrl, rotateDigitizationPage, splitDigitizationPage,
  type DigitizationPageDto,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { IconCrop, IconRotate, IconScanLine } from "../icons";

// Page image editing (crop/rotate/re-split) - its own modal, separate from the full-page
// PageEditorView (which owns text/chapter/status/OCR). Was briefly folded into PageEditorView's
// own toolbar as popovers, then split back out on request - chapter editing is the only thing that
// stayed in PageEditorView, everything else here is back to where it was.
export function PageEditModal({
  bookId, page, onClose,
}: {
  bookId: string;
  page: DigitizationPageDto;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [cacheBust, setCacheBust] = useState(0);
  const [customDegrees, setCustomDegrees] = useState(90);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [splitRatio, setSplitRatio] = useState(50);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["digitizationState", bookId] });
    setCacheBust(Date.now());
  };

  const rotateMutation = useMutation({
    mutationFn: (degrees: number) => rotateDigitizationPage(bookId, page.id, degrees),
    onSuccess: invalidate,
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const cropMutation = useMutation({
    mutationFn: () => cropDigitizationPage(bookId, page.id, crop.x / 100, crop.y / 100, crop.width / 100, crop.height / 100),
    onSuccess: () => {
      invalidate();
      setCrop({ x: 0, y: 0, width: 100, height: 100 });
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const splitMutation = useMutation({
    mutationFn: () => splitDigitizationPage(bookId, page.id, splitRatio / 100),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => notifications.show({ color: "red", message: err instanceof Error ? err.message : String(err) }),
  });

  const imageUrl = digitizationPageImageUrl(bookId, page.id, cacheBust || undefined);

  return (
    <Modal opened onClose={onClose} title={t("digitize.editPage", { page: page.order })} size="lg" centered>
      <Stack gap="md">
        <div style={{ position: "relative", display: "inline-block" }}>
          <Image src={imageUrl} mah={360} fit="contain" />
          <div
            style={{
              position: "absolute",
              border: "2px dashed var(--mantine-color-blue-6)",
              left: `${crop.x}%`,
              top: `${crop.y}%`,
              width: `${crop.width}%`,
              height: `${crop.height}%`,
              pointerEvents: "none",
            }}
          />
        </div>

        <Tabs defaultValue="rotate">
          <Tabs.List>
            <Tabs.Tab value="rotate" leftSection={<IconRotate size={14} />}>{t("digitize.rotate")}</Tabs.Tab>
            <Tabs.Tab value="crop" leftSection={<IconCrop size={14} />}>{t("digitize.crop")}</Tabs.Tab>
            <Tabs.Tab value="split" leftSection={<IconScanLine size={14} />}>{t("digitize.split")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="rotate" pt="md">
            <Group>
              <Button variant="default" loading={rotateMutation.isPending} onClick={() => rotateMutation.mutate(-90)}>
                {t("digitize.rotateLeft")}
              </Button>
              <Button variant="default" loading={rotateMutation.isPending} onClick={() => rotateMutation.mutate(90)}>
                {t("digitize.rotateRight")}
              </Button>
              <NumberInput value={customDegrees} onChange={(v) => setCustomDegrees(Number(v) || 0)} w={100} suffix="°" />
              <Button loading={rotateMutation.isPending} onClick={() => rotateMutation.mutate(customDegrees)}>
                {t("digitize.apply")}
              </Button>
            </Group>
          </Tabs.Panel>

          <Tabs.Panel value="crop" pt="md">
            <Stack gap="xs">
              <Group grow>
                <NumberInput label="X%" min={0} max={99} value={crop.x} onChange={(v) => setCrop((c) => ({ ...c, x: Number(v) || 0 }))} />
                <NumberInput label="Y%" min={0} max={99} value={crop.y} onChange={(v) => setCrop((c) => ({ ...c, y: Number(v) || 0 }))} />
              </Group>
              <Group grow>
                <NumberInput label="W%" min={1} max={100} value={crop.width} onChange={(v) => setCrop((c) => ({ ...c, width: Number(v) || 1 }))} />
                <NumberInput label="H%" min={1} max={100} value={crop.height} onChange={(v) => setCrop((c) => ({ ...c, height: Number(v) || 1 }))} />
              </Group>
              <Button loading={cropMutation.isPending} onClick={() => cropMutation.mutate()}>
                {t("digitize.apply")}
              </Button>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="split" pt="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">{t("digitize.splitExplain")}</Text>
              <Slider value={splitRatio} onChange={setSplitRatio} min={10} max={90} label={(v) => `${v}%`} />
              <Button loading={splitMutation.isPending} onClick={() => splitMutation.mutate()}>
                {t("digitize.apply")}
              </Button>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}

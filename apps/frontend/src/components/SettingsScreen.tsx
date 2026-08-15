import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, ColorSwatch, Group, Modal, Select, SegmentedControl, Stack, Tabs, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconBook2, IconBooks, IconCheck, IconFileImport, IconPalette } from "@tabler/icons-react";
import { getSystemCapabilities } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { getStoredDefaultFormat, setStoredDefaultFormat, type ConvertFormat } from "../convertFormat";
import {
  getStoredReaderEngine,
  getStoredReaderOpenMode,
  setStoredReaderEngine,
  setStoredReaderOpenMode,
  type ReaderEngine,
  type ReaderOpenMode,
} from "../readerSettings";
import { useThemeColor } from "../ThemeColorContext";
import { THEME_COLOR_OPTIONS } from "../theme";
import { URDU_FONT_OPTIONS, type UrduFontName } from "../urduFont";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LibrariesSettings } from "./LibrariesSettings";

interface SettingsScreenProps {
  opened: boolean;
  onClose: () => void;
  onLibraryChanged: () => void;
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
      {children}
    </Text>
  );
}

export function SettingsScreen({ opened, onClose, onLibraryChanged }: SettingsScreenProps) {
  const { t, urduFont, setUrduFont } = useLanguage();
  const { themeColor, setThemeColor } = useThemeColor();
  const [defaultFormat, setDefaultFormat] = useState<ConvertFormat>(getStoredDefaultFormat());
  const [readerOpenMode, setReaderOpenMode] = useState<ReaderOpenMode>(getStoredReaderOpenMode());
  const [epubEngine, setEpubEngine] = useState<ReaderEngine>(getStoredReaderEngine("Epub"));
  const [pdfEngine, setPdfEngine] = useState<ReaderEngine>(getStoredReaderEngine("Pdf"));

  const capabilitiesQuery = useQuery({ queryKey: ["systemCapabilities"], queryFn: getSystemCapabilities });
  const calibreAvailable = capabilitiesQuery.data?.calibreAvailable ?? false;

  const handleDefaultFormatChange = (value: string) => {
    const format = value as ConvertFormat;
    setDefaultFormat(format);
    setStoredDefaultFormat(format);
  };

  const handleReaderOpenModeChange = (value: string) => {
    const mode = value as ReaderOpenMode;
    setReaderOpenMode(mode);
    setStoredReaderOpenMode(mode);
  };

  const handleEngineChange = (format: "Epub" | "Pdf", value: string) => {
    const engine = value as ReaderEngine;
    (format === "Epub" ? setEpubEngine : setPdfEngine)(engine);
    setStoredReaderEngine(format, engine);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("settings.title")} size="xl" centered>
      <Tabs defaultValue="libraries" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="libraries" leftSection={<IconBooks size={14} />}>
            {t("settings.libraries")}
          </Tabs.Tab>
          <Tabs.Tab value="appearance" leftSection={<IconPalette size={14} />}>
            {t("settings.appearance")}
          </Tabs.Tab>
          <Tabs.Tab value="reading" leftSection={<IconBook2 size={14} />}>
            {t("settings.reading")}
          </Tabs.Tab>
          <Tabs.Tab value="import" leftSection={<IconFileImport size={14} />}>
            {t("settings.import")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="libraries" pt="lg">
          {/* Resyncing a specific library (including the active one) lives per-row here now -
              see LibrariesSettings - rather than as a separate blanket "rescan" action. */}
          <LibrariesSettings onActiveLibraryChanged={onLibraryChanged} />
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <FieldLabel>{t("settings.language")}</FieldLabel>
              <LanguageSwitcher />
            </Group>
            <Group justify="space-between">
              <FieldLabel>{t("settings.colorScheme")}</FieldLabel>
              <ColorSchemeToggle />
            </Group>
            <Group justify="space-between">
              <FieldLabel>{t("settings.themeColor")}</FieldLabel>
              <Group gap="xs">
                {THEME_COLOR_OPTIONS.map((option) => (
                  <UnstyledButton
                    key={option.value}
                    onClick={() => setThemeColor(option.value)}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <ColorSwatch
                      color={option.swatch}
                      size={26}
                      style={{
                        cursor: "pointer",
                        outline: themeColor === option.value ? "2px solid var(--mantine-color-text)" : "none",
                        outlineOffset: 2,
                      }}
                    >
                      {themeColor === option.value && <IconCheck size={13} color="white" />}
                    </ColorSwatch>
                  </UnstyledButton>
                ))}
              </Group>
            </Group>
            <Group justify="space-between">
              <FieldLabel>{t("settings.urduFont")}</FieldLabel>
              <Select
                size="sm"
                w={220}
                data={URDU_FONT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                value={urduFont}
                onChange={(value) => value && setUrduFont(value as UrduFontName)}
                allowDeselect={false}
              />
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="reading" pt="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <FieldLabel>{t("settings.readerWindow")}</FieldLabel>
              <SegmentedControl
                size="sm"
                data={[
                  { value: "window", label: t("settings.readerWindowPopout") },
                  { value: "inline", label: t("settings.readerWindowInline") },
                ]}
                value={readerOpenMode}
                onChange={handleReaderOpenModeChange}
              />
            </Group>
            <Group justify="space-between">
              <FieldLabel>{t("settings.epubReader")}</FieldLabel>
              <SegmentedControl
                size="sm"
                data={[
                  { value: "internal", label: t("settings.readerEngineInternal") },
                  { value: "external", label: t("settings.readerEngineExternal") },
                ]}
                value={epubEngine}
                onChange={(value) => handleEngineChange("Epub", value)}
              />
            </Group>
            <Group justify="space-between">
              <FieldLabel>{t("settings.pdfReader")}</FieldLabel>
              <SegmentedControl
                size="sm"
                data={[
                  { value: "internal", label: t("settings.readerEngineInternal") },
                  { value: "external", label: t("settings.readerEngineExternal") },
                ]}
                value={pdfEngine}
                onChange={(value) => handleEngineChange("Pdf", value)}
              />
            </Group>
            {(epubEngine === "external" || pdfEngine === "external") && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
                {t("settings.externalReaderWarning")}
              </Alert>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="import" pt="lg">
          <Stack gap={4}>
            <FieldLabel>{t("settings.defaultConvertFormat")}</FieldLabel>
            <Tooltip label={t("importDialog.calibreUnavailable")} disabled={calibreAvailable || capabilitiesQuery.isLoading}>
              <SegmentedControl
                size="sm"
                w={280}
                data={[
                  { value: "none", label: t("importDialog.convertNone") },
                  { value: "Epub", label: "EPUB" },
                  { value: "Pdf", label: "PDF" },
                ]}
                value={defaultFormat}
                onChange={handleDefaultFormatChange}
                disabled={!capabilitiesQuery.isLoading && !calibreAvailable}
              />
            </Tooltip>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

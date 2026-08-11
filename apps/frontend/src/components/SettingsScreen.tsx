import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  ColorSwatch,
  Divider,
  Group,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconFolderOpen, IconRefresh } from "@tabler/icons-react";
import { getSystemCapabilities, openLibrary, rescanLibrary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { invalidateLibraryQueries } from "../queries";
import { getStoredDefaultFormat, setStoredDefaultFormat, type ConvertFormat } from "../convertFormat";
import { useThemeColor } from "../ThemeColorContext";
import { THEME_COLOR_OPTIONS } from "../theme";
import { URDU_FONT_OPTIONS, type UrduFontName } from "../urduFont";
import { ColorSchemeToggle } from "./ColorSchemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface SettingsScreenProps {
  libraryPath: string;
  onLibraryChanged: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Title order={4} fw={600} mb="sm">
      {children}
    </Title>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text fz={10.5} fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.1em" }}>
      {children}
    </Text>
  );
}

export function SettingsScreen({ libraryPath, onLibraryChanged }: SettingsScreenProps) {
  const { t, urduFont, setUrduFont } = useLanguage();
  const { themeColor, setThemeColor } = useThemeColor();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultFormat, setDefaultFormat] = useState<ConvertFormat>(getStoredDefaultFormat());
  const [rescanConfirmOpen, setRescanConfirmOpen] = useState(false);
  const [isRescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const capabilitiesQuery = useQuery({ queryKey: ["systemCapabilities"], queryFn: getSystemCapabilities });
  const calibreAvailable = capabilitiesQuery.data?.calibreAvailable ?? false;

  const handleDefaultFormatChange = (value: string) => {
    const format = value as ConvertFormat;
    setDefaultFormat(format);
    setStoredDefaultFormat(format);
  };

  const handleChangeLibrary = async () => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await openLibrary(folder);
      onLibraryChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRescan = async () => {
    setRescanConfirmOpen(false);
    setRescanning(true);
    setRescanError(null);
    try {
      await rescanLibrary();
      invalidateLibraryQueries(queryClient);
    } catch (err) {
      setRescanError(err instanceof Error ? err.message : String(err));
    } finally {
      setRescanning(false);
    }
  };

  return (
    <Box p="xl" maw={560}>
      <Title order={2} mb="lg">
        {t("settings.title")}
      </Title>

      <SectionTitle>{t("settings.library")}</SectionTitle>
      <Stack gap={4} mb="sm">
        <FieldLabel>{t("settings.libraryPath")}</FieldLabel>
        <Text ff="var(--mantine-font-family-monospace)" size="sm">
          {libraryPath}
        </Text>
      </Stack>

      <Button
        variant="default"
        leftSection={<IconFolderOpen size={16} />}
        onClick={() => void handleChangeLibrary()}
        loading={busy}
      >
        {t("settings.changeLibrary")}
      </Button>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("settings.changeLibraryErrorTitle")} mt="md">
          {error}
        </Alert>
      )}

      <Divider my="lg" />

      <SectionTitle>{t("settings.appearance")}</SectionTitle>
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

      <Divider my="lg" />

      <SectionTitle>{t("settings.import")}</SectionTitle>
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

      <Divider my="lg" />

      <SectionTitle>{t("settings.maintenance")}</SectionTitle>
      {rescanConfirmOpen ? (
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{t("app.rescanBody")}</Text>
          <Group gap="xs">
            <Button variant="default" size="sm" onClick={() => setRescanConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button color="red" size="sm" onClick={() => void handleRescan()}>
              {t("app.rescanConfirm")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          onClick={() => setRescanConfirmOpen(true)}
          loading={isRescanning}
        >
          {t("toolbar.rescan")}
        </Button>
      )}

      {rescanError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("app.rescanFailedTitle")} mt="md">
          {rescanError}
        </Alert>
      )}
    </Box>
  );
}

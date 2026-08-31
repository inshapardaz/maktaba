import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Group, Modal, Skeleton, Stack, Stepper, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconBooks, IconCompass, IconFolderOpen, IconHelpCircle, IconUpload } from "../icons";
import { openLibrary } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { markOnboardingComplete } from "../onboarding";

interface OnboardingTourProps {
  opened: boolean;
  onClose: () => void;
  // Whether a library is already open - true when replaying the tour from Settings -> Help (only
  // reachable once a library exists), false on a genuine first run. Lets step 2 skip its own
  // "choose a folder" gate when there's nothing left to do.
  hasLibrary: boolean;
  // Reuses the same window.maktaba.pickLibraryFolder() + openLibrary() flow LibraryPicker.tsx
  // uses for the very first library - invalidates the ["library"] query on success so the rest of
  // the app (still underneath this modal) picks up the newly-opened library immediately.
  onLibraryOpened: () => void;
}

// Screenshots are shared between the docs site and the in-app viewer (see help.ts's
// maktaba:read-help-asset) - resolves a docs/screenshots/*.svg placeholder (or, once captured,
// the user's real screenshot under the same filename) into a displayable data URL.
function TourImage({ filename, alt }: { filename: string; alt: string }) {
  const assetQuery = useQuery({
    queryKey: ["helpAsset", filename],
    queryFn: () => window.maktaba.readHelpAsset(filename),
  });

  if (!assetQuery.data) {
    return <Skeleton height={220} radius="md" />;
  }
  return <img src={assetQuery.data} alt={alt} style={{ maxWidth: "100%", borderRadius: 8 }} />;
}

export function OnboardingTour({ opened, onClose, hasLibrary, onLibraryOpened }: OnboardingTourProps) {
  const { t } = useLanguage();
  const [active, setActive] = useState(0);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryJustOpened, setLibraryJustOpened] = useState(false);

  // Re-applied whenever the tour is (re)opened, not just on first mount - Replay Getting Started
  // Tour (HelpSettings.tsx) reopens this same modal instance rather than remounting it.
  useEffect(() => {
    if (opened) {
      setActive(0);
      setLibraryError(null);
      setLibraryJustOpened(false);
    }
  }, [opened]);

  const finish = () => {
    markOnboardingComplete();
    onClose();
  };

  const handleChooseLibrary = async () => {
    const folder = await window.maktaba.pickLibraryFolder();
    if (!folder) return;
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      await openLibrary(folder);
      onLibraryOpened();
      setLibraryJustOpened(true);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLibraryBusy(false);
    }
  };

  const libraryStepSatisfied = hasLibrary || libraryJustOpened;

  return (
    <Modal
      opened={opened}
      onClose={finish}
      closeOnClickOutside={false}
      title={t("onboarding.title")}
      size="lg"
      centered
    >
      <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false} size="sm">
        <Stepper.Step label={t("onboarding.step1Label")} icon={<IconCompass size={18} />}>
          <Stack gap="sm" py="sm">
            <Title order={4}>{t("onboarding.step1Title")}</Title>
            <Text size="sm" c="dimmed">
              {t("onboarding.step1Body")}
            </Text>
            <Group justify="center" mt="xs">
              <LanguageSwitcher />
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("onboarding.step2Label")} icon={<IconFolderOpen size={18} />}>
          <Stack gap="sm" py="sm">
            <Title order={4}>{t("onboarding.step2Title")}</Title>
            <Text size="sm" c="dimmed">
              {t("onboarding.step2Body")}
            </Text>
            {libraryStepSatisfied ? (
              <Alert color="green" variant="light">
                {t("onboarding.step2Done")}
              </Alert>
            ) : (
              <Group justify="center" mt="xs">
                <Button leftSection={<IconFolderOpen size={16} />} onClick={handleChooseLibrary} loading={libraryBusy}>
                  {t("onboarding.step2Button")}
                </Button>
              </Group>
            )}
            {libraryError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {libraryError}
              </Alert>
            )}
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("onboarding.step3Label")} icon={<IconUpload size={18} />}>
          <Stack gap="sm" py="sm">
            <Title order={4}>{t("onboarding.step3Title")}</Title>
            <Text size="sm" c="dimmed">
              {t("onboarding.step3Body")}
            </Text>
            <TourImage filename="tour-import.svg" alt={t("onboarding.step3Title")} />
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("onboarding.step4Label")} icon={<IconBooks size={18} />}>
          <Stack gap="sm" py="sm">
            <Title order={4}>{t("onboarding.step4Title")}</Title>
            <Text size="sm" c="dimmed">
              {t("onboarding.step4Body")}
            </Text>
            <TourImage filename="tour-organize.svg" alt={t("onboarding.step4Title")} />
          </Stack>
        </Stepper.Step>

        <Stepper.Step label={t("onboarding.step5Label")} icon={<IconHelpCircle size={18} />}>
          <Stack gap="sm" py="sm">
            <Title order={4}>{t("onboarding.step5Title")}</Title>
            <Text size="sm" c="dimmed">
              {t("onboarding.step5Body")}
            </Text>
            <Group justify="center" mt="xs">
              <Button
                variant="light"
                leftSection={<IconHelpCircle size={16} />}
                onClick={() => {
                  finish();
                  void window.maktaba.openHelpWindow();
                }}
              >
                {t("onboarding.openHelp")}
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
      </Stepper>

      <Group justify="space-between" mt="lg">
        <Button variant="subtle" color="gray" onClick={finish}>
          {t("onboarding.skip")}
        </Button>
        <Group gap="xs">
          {active > 0 && (
            <Button variant="default" onClick={() => setActive((s) => s - 1)}>
              {t("onboarding.back")}
            </Button>
          )}
          {active < 4 ? (
            <Button onClick={() => setActive((s) => s + 1)} disabled={active === 1 && !libraryStepSatisfied}>
              {t("onboarding.next")}
            </Button>
          ) : (
            <Button onClick={finish}>{t("onboarding.finish")}</Button>
          )}
        </Group>
      </Group>
    </Modal>
  );
}

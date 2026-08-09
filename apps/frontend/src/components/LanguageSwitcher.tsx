import { SegmentedControl } from "@mantine/core";
import { LANGUAGES, type Language } from "../i18n/translations";
import { useLanguage } from "../i18n/LanguageContext";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <SegmentedControl
      size="sm"
      aria-label={t("toolbar.language")}
      value={language}
      onChange={(value) => setLanguage(value as Language)}
      data={LANGUAGES}
    />
  );
}

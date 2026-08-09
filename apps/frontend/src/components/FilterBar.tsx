import { Group, Select, TextInput, Pill } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useLanguage } from "../i18n/LanguageContext";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  minRating: number;
  onMinRatingChange: (value: number) => void;
  activeGroupLabel: string | null;
  onClearGroup: () => void;
}

const RATING_OPTIONS = [
  { value: "0", label: "" },
  { value: "1", label: "★+" },
  { value: "2", label: "★★+" },
  { value: "3", label: "★★★+" },
  { value: "4", label: "★★★★+" },
  { value: "5", label: "★★★★★" },
];

export function FilterBar({
  search,
  onSearchChange,
  format,
  onFormatChange,
  minRating,
  onMinRatingChange,
  activeGroupLabel,
  onClearGroup,
}: FilterBarProps) {
  const { t } = useLanguage();

  const formatOptions = [
    { value: "", label: t("filterBar.allFormats") },
    { value: "Epub", label: "EPUB" },
    { value: "Pdf", label: "PDF" },
  ];

  const ratingOptions = RATING_OPTIONS.map((option) =>
    option.value === "0" ? { ...option, label: t("filterBar.anyRating") } : option,
  );

  return (
    <Group
      px="md"
      py="sm"
      gap="sm"
      wrap="wrap"
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <TextInput
        flex="0 1 360px"
        placeholder={t("filterBar.searchPlaceholder")}
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
      />

      <Select
        w={140}
        data={formatOptions}
        value={format}
        onChange={(value) => onFormatChange(value ?? "")}
        allowDeselect={false}
      />

      <Select
        w={140}
        data={ratingOptions}
        value={String(minRating)}
        onChange={(value) => onMinRatingChange(Number(value ?? 0))}
        allowDeselect={false}
      />

      {activeGroupLabel && (
        <Pill withRemoveButton onRemove={onClearGroup}>
          {activeGroupLabel}
        </Pill>
      )}
    </Group>
  );
}

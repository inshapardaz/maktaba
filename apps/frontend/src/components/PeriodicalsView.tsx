import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Badge, Box, Button, Group, NavLink, Select, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconSearch, IconTrash } from "@tabler/icons-react";
import { createPeriodical, deletePeriodical, listPeriodicals, type PeriodicalFrequency } from "../api";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";
import { BrowseViewHeader } from "./BrowseViewHeader";

interface PeriodicalsViewProps {
  onOpen: (id: string) => void;
  onBack: () => void;
}

const FREQUENCIES: PeriodicalFrequency[] = ["Daily", "Weekly", "BiWeekly", "Monthly", "Quarterly", "Yearly", "Occasional"];

export function PeriodicalsView({ onOpen, onBack }: PeriodicalsViewProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<PeriodicalFrequency>("Occasional");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const periodicalsQuery = useQuery({ queryKey: ["periodicals"], queryFn: listPeriodicals });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["periodicals"] });

  const createMutation = useMutation({
    mutationFn: (vars: { name: string; frequency: PeriodicalFrequency }) => createPeriodical(vars.name, vars.frequency),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePeriodical(id),
    onSuccess: () => {
      setConfirmingDeleteId(null);
      invalidate();
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      createMutation.mutate({ name: trimmed, frequency });
    }
  };

  const filtered = useMemo(() => {
    const periodicals = periodicalsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const matched = term ? periodicals.filter((p) => p.name.toLowerCase().includes(term)) : periodicals;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name));
  }, [periodicalsQuery.data, search]);

  return (
    <Box display="flex" style={{ flexDirection: "column", height: "100%" }}>
      <BrowseViewHeader title={t("periodicalsView.title")} onBack={onBack} />

      <Box p="xl" maw={640} style={{ flex: 1, overflow: "auto" }}>
        <form onSubmit={handleAdd}>
          <Group gap="xs" mb="md" align="flex-end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              label={t("periodicalsView.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Select
              label={t("periodicalsView.frequency")}
              data={FREQUENCIES.map((f) => ({ value: f, label: t(`periodicalsView.frequency.${f}` as TranslationKey) }))}
              value={frequency}
              onChange={(value) => value && setFrequency(value as PeriodicalFrequency)}
              allowDeselect={false}
              w={160}
            />
            <Button type="submit" loading={createMutation.isPending} disabled={name.trim().length === 0}>
              {t("periodicalsView.add")}
            </Button>
          </Group>
        </form>

        <TextInput
          mb="md"
          placeholder={t("periodicalsView.searchPlaceholder")}
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Stack gap={2}>
          {filtered.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("periodicalsView.empty")}
            </Text>
          )}

          {filtered.map((periodical) => (
            <Group
              key={periodical.id}
              justify="space-between"
              wrap="nowrap"
              gap="xs"
              style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
            >
              <NavLink
                label={periodical.name}
                description={t(`periodicalsView.frequency.${periodical.frequency}` as TranslationKey)}
                onClick={() => onOpen(periodical.id)}
                style={{ flex: 1 }}
                px="sm"
                py={6}
                styles={{ root: { borderRadius: "var(--mantine-radius-sm)" } }}
                rightSection={
                  <Badge size="sm" variant="light" color="gray" tt="none">
                    {t(
                      periodical.issueCount === 1 ? "periodicalsView.issueCount_one" : "periodicalsView.issueCount_other",
                      { count: periodical.issueCount },
                    )}
                  </Badge>
                }
              />
              {confirmingDeleteId === periodical.id ? (
                <Group gap={4} wrap="nowrap">
                  <Button size="xs" color="red" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate(periodical.id)}>
                    {t("common.confirm")}
                  </Button>
                  <Button size="xs" variant="subtle" onClick={() => setConfirmingDeleteId(null)}>
                    {t("common.cancel")}
                  </Button>
                </Group>
              ) : (
                <Tooltip label={periodical.issueCount > 0 ? t("periodicalsView.cannotDelete") : t("periodicalsView.confirmDelete")}>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    disabled={periodical.issueCount > 0}
                    onClick={() => setConfirmingDeleteId(periodical.id)}
                    aria-label={t("periodicalsView.confirmDelete")}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

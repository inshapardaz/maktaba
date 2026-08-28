import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Alert, Badge, Box, Button, Group, Modal, NavLink, Select, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconSearch, IconTrash } from "@tabler/icons-react";
import { createPeriodical, deletePeriodical, listPeriodicals, type Periodical, type PeriodicalFrequency } from "../api";
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
  // Holds the periodical a delete is pending confirmation for (not just its id) so the modal can
  // show its name/issue count without a second lookup.
  const [confirmingDelete, setConfirmingDelete] = useState<Periodical | null>(null);

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
    mutationFn: async (periodical: Periodical) => {
      const { folderPath } = await deletePeriodical(periodical.id, periodical.issueCount > 0);
      await window.maktaba.trashPath(folderPath);
    },
    onSuccess: () => {
      setConfirmingDelete(null);
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
              <Tooltip label={t("periodicalsView.confirmDelete")}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setConfirmingDelete(periodical)}
                  aria-label={t("periodicalsView.confirmDelete")}
                >
                  <IconTrash size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      </Box>

      <Modal
        opened={confirmingDelete !== null}
        onClose={() => setConfirmingDelete(null)}
        title={t("periodicalsView.deleteConfirmTitle")}
        centered
      >
        {confirmingDelete && (
          <Stack gap="md">
            <Text size="sm">
              {confirmingDelete.issueCount > 0
                ? t("periodicalsView.deleteWarning", {
                    name: confirmingDelete.name,
                    issues: t(
                      confirmingDelete.issueCount === 1 ? "periodicalsView.issueCount_one" : "periodicalsView.issueCount_other",
                      { count: confirmingDelete.issueCount },
                    ),
                  })
                : t("periodicalsView.confirmDelete")}
            </Text>
            {deleteMutation.isError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {deleteMutation.error instanceof Error ? deleteMutation.error.message : String(deleteMutation.error)}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmingDelete(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                color="red"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(confirmingDelete)}
              >
                {t("common.confirm")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Box>
  );
}

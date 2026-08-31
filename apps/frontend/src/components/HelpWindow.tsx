import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Anchor, Box, Button, Group, Loader, ScrollArea, Skeleton, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "../icons";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLanguage } from "../i18n/LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

// Renders one markdown <img> by resolving its src through the readHelpAsset IPC bridge (help.ts)
// into a base64 data URL - the renderer has no direct filesystem access to either the packaged
// help resources or the dev-mode docs/ source, same as every other native operation in this app.
function HelpImage({ src, alt }: { src?: string; alt?: string }) {
  const assetQuery = useQuery({
    queryKey: ["helpAsset", src],
    queryFn: () => window.maktaba.readHelpAsset(src ?? ""),
    enabled: !!src,
  });

  if (!src) return null;
  if (!assetQuery.data) {
    return <Skeleton height={180} radius="md" my="sm" />;
  }
  return <img src={assetQuery.data} alt={alt ?? ""} style={{ maxWidth: "100%", borderRadius: 8, display: "block", margin: "8px 0" }} />;
}

// Content for the dedicated Help window (a separate top-level BrowserWindow opened via the
// title bar's Help button - see apps/desktop/src/main.ts's openHelpWindow and TitleBar.tsx) - not
// a Settings tab, since help content (multi-page, screenshot-heavy, meant to stay open while
// using the rest of the app) doesn't fit the same small modal the other Settings tabs do.
export function HelpWindow() {
  const { language, t } = useLanguage();
  const [selectedSlug, setSelectedSlug] = useState("index");

  const topicsQuery = useQuery({
    queryKey: ["helpTopics", language],
    queryFn: () => window.maktaba.listHelpTopics(language),
  });

  const topicQuery = useQuery({
    queryKey: ["helpTopic", language, selectedSlug],
    queryFn: () => window.maktaba.readHelpTopic(language, selectedSlug),
  });

  const topics = topicsQuery.data ?? [];

  // Markdown help articles cross-link each other with relative, extensionless paths matching the
  // docs site's own clean-URL convention (e.g. "./libraries") - intercepted here to switch the
  // selected topic in place instead of navigating this window away from the app.
  const markdownComponents: Components = {
    img: ({ src, alt }) => <HelpImage src={typeof src === "string" ? src : undefined} alt={alt} />,
    a: ({ href, children }) => {
      const relativeMatch = href?.match(/^\.\/([\w-]+)\/?$/);
      if (relativeMatch) {
        return (
          <Anchor component="button" type="button" size="sm" onClick={() => setSelectedSlug(relativeMatch[1])}>
            {children}
          </Anchor>
        );
      }
      return (
        <Anchor href={href} target="_blank" rel="noreferrer">
          {children}
        </Anchor>
      );
    },
  };

  return (
    <Box p="lg" h="100vh" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Title order={3}>{t("settings.help")}</Title>
        <Group gap="sm" wrap="nowrap">
          <LanguageSwitcher />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void window.maktaba.replayOnboardingTour()}
          >
            {t("settings.replayTour")}
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        {t("settings.helpIntro")}
      </Text>

      <Group align="flex-start" gap="lg" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea style={{ width: 240, flexShrink: 0, height: "100%" }} type="auto">
          <Stack gap={2}>
            {topics.map((topic) => {
              const active = topic.slug === selectedSlug;
              return (
                <UnstyledButton
                  key={topic.slug}
                  onClick={() => setSelectedSlug(topic.slug)}
                  px="sm"
                  py={6}
                  style={{
                    borderRadius: 6,
                    background: active ? "var(--mantine-color-default-hover)" : undefined,
                  }}
                >
                  <Text size="sm" fw={active ? 600 : 400}>
                    {topic.title}
                  </Text>
                </UnstyledButton>
              );
            })}
          </Stack>
        </ScrollArea>

        <ScrollArea style={{ flex: 1, height: "100%" }} type="auto">
          {topicQuery.isLoading ? (
            <Group justify="center" py="xl">
              <Loader size="sm" />
            </Group>
          ) : topicQuery.data ? (
            <div className="help-article">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {topicQuery.data.bodyMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {t("settings.helpLoadError")}
            </Alert>
          )}
        </ScrollArea>
      </Group>
    </Box>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Center, Loader, useComputedColorScheme } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { Reader, LOCALES } from "@inshapardaz/qari";
import type { ReaderError } from "@inshapardaz/qari/models";
import { getBookFile } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface ReaderOverlayProps {
  bookId: string;
  format: "Epub" | "Pdf";
}

export function ReaderOverlay({ bookId, format }: ReaderOverlayProps) {
  const { t, language } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const [readerError, setReaderError] = useState<ReaderError | null>(null);

  const fileQuery = useQuery({
    queryKey: ["bookFile", bookId, format],
    queryFn: () => getBookFile(bookId, format),
  });

  return (
    <Box pos="fixed" top={0} left={0} right={0} bottom={0} bg="var(--mantine-color-body)" style={{ zIndex: 2000 }}>
      {fileQuery.isLoading && (
        <Center h="100%">
          <Loader />
        </Center>
      )}

      {fileQuery.isError && (
        <Center h="100%" p="xl">
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("reader.loadErrorTitle")} maw={480}>
            {fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}
          </Alert>
        </Center>
      )}

      {readerError && (
        <Center h="100%" p="xl">
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("reader.errorTitle")} maw={480}>
            {readerError.message}
          </Alert>
        </Center>
      )}

      {fileQuery.data && !readerError && (
        <Reader
          source={format === "Epub" ? { type: "epub", data: fileQuery.data } : { type: "pdf", data: fileQuery.data }}
          theme={colorScheme === "dark" ? "dark" : "light"}
          direction="auto"
          fontFamily={language === "ur" ? "nastaliq" : "serif"}
          translations={LOCALES[language]}
          showCloseButton={false}
          onError={(event) => setReaderError(event)}
        />
      )}
    </Box>
  );
}

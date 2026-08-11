import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Center, CloseButton, Loader, useComputedColorScheme } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { Reader, LOCALES } from "@inshapardaz/qari";
import type { ReaderError } from "@inshapardaz/qari/models";
import { getBookFile } from "../api";
import { useLanguage } from "../i18n/LanguageContext";

interface ReaderOverlayProps {
  bookId: string;
  format: "Epub" | "Pdf";
  onClose: () => void;
}

export function ReaderOverlay({ bookId, format, onClose }: ReaderOverlayProps) {
  const { t, language } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const [readerError, setReaderError] = useState<ReaderError | null>(null);

  const fileQuery = useQuery({
    queryKey: ["bookFile", bookId, format],
    queryFn: () => getBookFile(bookId, format),
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Box pos="fixed" top={0} left={0} right={0} bottom={0} bg="var(--mantine-color-body)" style={{ zIndex: 2000 }}>
      <CloseButton
        onClick={onClose}
        size="lg"
        aria-label={t("reader.close")}
        pos="absolute"
        top={12}
        style={{ insetInlineEnd: 12, zIndex: 2001 }}
      />

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
          // "auto" lets Qari's own DirectionDetector read the book's language and pick RTL/LTR
          // per book - forcing it to Maktaba's own UI language here previously meant an Urdu book
          // would render LTR whenever the app's UI language happened to be English, and vice versa.
          direction="auto"
          fontFamily={language === "ur" ? "nastaliq" : "serif"}
          translations={LOCALES[language]}
          onError={(event) => setReaderError(event)}
        />
      )}
    </Box>
  );
}

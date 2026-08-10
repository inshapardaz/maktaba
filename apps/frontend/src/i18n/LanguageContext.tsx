import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDirection } from "@mantine/core";
import { translations, type Language, type TranslationKey } from "./translations";

const STORAGE_KEY = "maktaba-language";

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }
  return window.localStorage.getItem(STORAGE_KEY) === "ur" ? "ur" : "en";
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const { setDirection } = useDirection();

  useEffect(() => {
    setDirection(language === "ur" ? "rtl" : "ltr");
    document.body.classList.toggle("lang-ur", language === "ur");
  }, [language, setDirection]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: (next) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setLanguageState(next);
      },
      t: (key, vars) => {
        let text = translations[language][key] ?? translations.en[key] ?? key;
        if (vars) {
          for (const [name, val] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(val));
          }
        }
        return text;
      },
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}

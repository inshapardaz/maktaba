import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDirection } from "@mantine/core";
import { translations, type Language, type TranslationKey } from "./translations";
import { DEFAULT_URDU_FONT, URDU_FONT_OPTIONS, type UrduFontName } from "../urduFont";

const STORAGE_KEY = "maktaba-language";
const URDU_FONT_STORAGE_KEY = "maktaba-urdu-font";
const VALID_URDU_FONTS = new Set<string>(URDU_FONT_OPTIONS.map((option) => option.value));

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }
  return window.localStorage.getItem(STORAGE_KEY) === "ur" ? "ur" : "en";
}

export function getStoredUrduFont(): UrduFontName {
  if (typeof window === "undefined") {
    return DEFAULT_URDU_FONT;
  }
  const stored = window.localStorage.getItem(URDU_FONT_STORAGE_KEY);
  return stored && VALID_URDU_FONTS.has(stored) ? (stored as UrduFontName) : DEFAULT_URDU_FONT;
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  urduFont: UrduFontName;
  setUrduFont: (font: UrduFontName) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const [urduFont, setUrduFontState] = useState<UrduFontName>(getStoredUrduFont);
  const { setDirection } = useDirection();

  useEffect(() => {
    setDirection(language === "ur" ? "rtl" : "ltr");
    document.body.classList.toggle("lang-ur", language === "ur");

    const stack = URDU_FONT_OPTIONS.find((option) => option.value === urduFont)?.stack ?? URDU_FONT_OPTIONS[0].stack;
    document.documentElement.style.setProperty("--urdu-font-family", stack);
  }, [language, urduFont, setDirection]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: (next) => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setLanguageState(next);
      },
      urduFont,
      setUrduFont: (next) => {
        window.localStorage.setItem(URDU_FONT_STORAGE_KEY, next);
        setUrduFontState(next);
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
    [language, urduFont],
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

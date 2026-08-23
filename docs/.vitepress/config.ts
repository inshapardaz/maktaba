import { defineConfig } from "vitepress";
import { helpTopics } from "../topics.cjs";

function sidebarFor(locale: "en" | "ur") {
  return [
    {
      text: locale === "en" ? "Help Topics" : "مدد کے موضوعات",
      items: helpTopics.map((topic) => ({
        text: topic.title[locale],
        link: topic.slug === "index" ? `/${locale}/` : `/${locale}/${topic.slug}`,
      })),
    },
  ];
}

export default defineConfig({
  title: "Maktaba Help",
  description: "Help documentation for Maktaba, the local-first ebook library manager.",
  cleanUrls: true,
  head: [["link", { rel: "icon", type: "image/png", href: "/logo.png" }]],

  locales: {
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      title: "Maktaba Help",
      description: "Help documentation for Maktaba.",
      themeConfig: {
        nav: [{ text: "Help", link: "/en/" }],
        sidebar: sidebarFor("en"),
        outline: { label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" },
        returnToTopLabel: "Return to top",
        darkModeSwitchLabel: "Appearance",
      },
    },
    ur: {
      label: "اردو",
      lang: "ur",
      dir: "rtl",
      link: "/ur/",
      title: "مکتبہ مدد",
      description: "مکتبہ کے استعمال میں مدد کے لیے دستاویزات۔",
      themeConfig: {
        nav: [{ text: "مدد", link: "/ur/" }],
        sidebar: sidebarFor("ur"),
        outline: { label: "اس صفحے پر" },
        docFooter: { prev: "پچھلا", next: "اگلا" },
        returnToTopLabel: "اوپر جائیں",
        darkModeSwitchLabel: "ظاہری شکل",
      },
    },
  },

  themeConfig: {
    logo: "/logo.png",
    socialLinks: [{ icon: "github", link: "https://github.com/inshapardaz/maktaba" }],
    search: { provider: "local" },
  },
});

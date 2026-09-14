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
  // GitHub Pages serves this as a project site at github.com/inshapardaz/maktaba's Pages URL, i.e.
  // under a /maktaba/ path rather than a domain root - every generated asset/link path needs this
  // prefix or they'd all 404 once actually deployed there (this only affects the built static site;
  // the in-app offline Help window never goes through this build at all - see help.ts/
  // build-help-content.mjs, which read the same source .md files directly instead).
  base: "/maktaba/",
  // Unlike themeConfig.logo (which VitePress base-prefixes for you), a plain head <link> href isn't
  // rewritten automatically - has to match `base` above literally, or the favicon 404s once deployed.
  head: [["link", { rel: "icon", type: "image/png", href: "/maktaba/logo.png" }]],

  locales: {
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      title: "Maktaba Help",
      description: "Help documentation for Maktaba.",
      themeConfig: {
        nav: [
          { text: "Help", link: "/en/" },
          { text: "Privacy Policy", link: "/privacy-policy" },
          { text: "Terms & Conditions", link: "/terms-and-conditions" },
        ],
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
        // Privacy Policy/Terms & Conditions are English-only (no Urdu translation exists), so the
        // nav label stays English too rather than promising a translated page these links don't lead to.
        nav: [
          { text: "مدد", link: "/ur/" },
          { text: "Privacy Policy", link: "/privacy-policy" },
          { text: "Terms & Conditions", link: "/terms-and-conditions" },
        ],
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

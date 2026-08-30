// Single source of truth for the help topic list. Written as CommonJS specifically so it can be
// loaded identically from three different module contexts without any build step in between:
//   - docs/.vitepress/config.ts (bundled by esbuild for VitePress — CJS-interop import)
//   - scripts/build-help-content.mjs (a plain ESM script — Node's CJS-named-exports interop)
//   - apps/desktop/src/help.ts (compiled to CommonJS — plain require())
// A real ESM module (.mjs) can't be `require()`d synchronously from the CommonJS-compiled
// Electron main process (Node throws ERR_REQUIRE_ESM), so CJS is the one format all three sides
// can consume without extra tooling.

/** @typedef {{ slug: string, title: { en: string, ur: string } }} HelpTopic */

/** @type {HelpTopic[]} */
const helpTopics = [
  { slug: "index", title: { en: "Getting Started", ur: "شروع کریں" } },
  { slug: "libraries", title: { en: "Choosing & Switching Libraries", ur: "لائبریری کا انتخاب اور تبدیلی" } },
  { slug: "importing", title: { en: "Importing Books", ur: "کتابیں درآمد کرنا" } },
  { slug: "organizing", title: { en: "Organizing Your Library", ur: "لائبریری کو ترتیب دینا" } },
  { slug: "reading", title: { en: "Reading Books", ur: "کتابیں پڑھنا" } },
  { slug: "analytics", title: { en: "Reading Analytics", ur: "مطالعاتی تجزیات" } },
  { slug: "settings", title: { en: "Settings & Preferences", ur: "ترتیبات" } },
  { slug: "troubleshooting", title: { en: "Troubleshooting & FAQ", ur: "مسائل کا حل اور سوالات" } },
];

const locales = ["en", "ur"];

module.exports = { helpTopics, locales };

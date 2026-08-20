// lang.js — shared Tamil/English toggle for the staff-facing pages (login,
// signup, reset, dashboard, entry, leaves, settings). Mirrors theme.js's
// shape: a localStorage-backed attribute on <html>, an early inline <head>
// snippet to avoid a flash of the wrong language, and a toggle button
// wired per-page.
//
// Unlike theme (pure CSS), swapping language means rewriting DOM text — so
// toggleLanguage() persists the choice and RELOADS the page rather than
// live-patching everything in place. Every render path already calls
// t()/stockLabel() while building strings, so a fresh load naturally comes
// out in the right language, identical to any other page load. This keeps
// every page's existing render code untouched — no "re-render on toggle"
// plumbing needed anywhere, even on dashboard.html's ~150 dynamic strings.
//
// Each page defines its own `PAGE_DICT = { en: {...}, ta: {...} }` (in its
// own inline <script>, anywhere before DOMContentLoaded — load order
// relative to this file doesn't matter, since PAGE_DICT is only read once
// applyTranslations() actually runs). Convention:
//   data-i18n="key"                                → sets el.textContent
//   data-i18n-attr="placeholder:key;title:key2"     → sets one or more attrs
// A dictionary entry is either a plain string, or a function(vars) for
// interpolated/pluralized text (each language handles that differently, so
// there's no shared {{var}} templater — just en/ta functions side by side).
// Dynamic JS strings (toasts, confirm dialogs, etc.) call t('key', vars)
// directly at the call site instead of using data-i18n.
//
// Pages must inline-apply the saved language at the very top of <head>,
// alongside the existing theme snippet, before any CSS loads:
//   if (localStorage.getItem('aj_lang') === 'ta') document.documentElement.dataset.lang = 'ta';
// paired with the FOUC guard in shared.css:
//   html[data-lang="ta"]:not(.i18n-ready) { visibility: hidden; }
// which applyTranslations() below releases as soon as it's done — a
// synchronous DOM walk, so English users see zero delay and Tamil users
// see at most a few milliseconds of hidden content, never raw English.
const LANG_KEY = 'aj_lang';

function getLang() {
  return document.documentElement.dataset.lang === 'ta' ? 'ta' : 'en';
}

// t(key, vars?) — looks up `key` in the current page's PAGE_DICT for the
// active language, falling back to English, then to the raw key itself so
// a missing translation is visibly obvious instead of silently blank.
function t(key, vars) {
  const dict  = (typeof PAGE_DICT !== 'undefined') ? PAGE_DICT : null;
  const lang  = getLang();
  const entry = dict && (dict[lang]?.[key] ?? dict.en?.[key]);
  if (entry == null) return key;
  return typeof entry === 'function' ? entry(vars || {}) : entry;
}

// nav.js injects the shared sidebar into EVERY authenticated page, including
// the 5 owner-only pages that never load lang.js at all — so its ~15 strings
// can't live in each page's own PAGE_DICT (that would only translate the
// sidebar on the 7 in-scope pages that happen to also define those same
// keys, and out-of-scope pages must stay English by construction, not by
// coincidence). Kept as an independent NAV_DICT + data-i18n-nav attribute,
// defined in nav.js itself: on the 5 out-of-scope pages nav.js still sets
// these attributes, but since THIS file is never loaded there,
// applyTranslations() never runs and the plain English text nav.js already
// wrote stays untouched — no lang.js, no translation, by construction.
function tNav(key) {
  const dict  = (typeof NAV_DICT !== 'undefined') ? NAV_DICT : null;
  const lang  = getLang();
  const entry = dict && (dict[lang]?.[key] ?? dict.en?.[key]);
  return entry == null ? key : entry;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s && s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  document.querySelectorAll('[data-i18n-nav]').forEach(el => {
    el.textContent = tNav(el.getAttribute('data-i18n-nav'));
  });
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.textContent = getLang() === 'ta' ? 'EN' : 'TA';
  });
  document.documentElement.classList.add('i18n-ready');
}

function toggleLanguage() {
  const next = getLang() === 'ta' ? 'en' : 'ta';
  localStorage.setItem(LANG_KEY, next);
  location.reload();
}

// Shared stock-category label lookup — labels come from the server
// (/api/stock-categories, .label field), not the page, so translating them
// can't be a data-i18n attribute. Kept as ONE dictionary here (not
// duplicated per page) so dashboard.html and entry.html never disagree on
// what a given stock is called in Tamil. Keyed by the built-in category
// ids (STOCK_META in server.js) — a custom stock an owner adds later
// without a Tamil entry here just falls back to its English label.
const STOCK_LABEL_TA = {
  collection:       'கலெக்‌ஷன்',
  chain_stock:      'சங்கிலி பங்கு',
  drops_stock:      'ட்ராப்ஸ் பங்கு',
  ring_stock:       'மோதிரம் பங்கு',
  metty_mookuthi:   'மெட்டி, மூக்குத்தி பங்கு',
  pathiram_stock:   'பாத்திரம் பங்கு',
  sl_stock:         'எஸ்எல் பங்கு',
  kolusu_stock:     'கொலுசு பங்கு',
  chain_arrange:    'சங்கிலி அடுக்குதல்',
  drops_arrange:    'ட்ராப்ஸ் அடுக்குதல்',
  tray_arrange:     'தட்டு அடுக்குதல்',
  silver_arrange:   'வெள்ளி அடுக்குதல்',
  morning_cleaning: 'காலை சுத்தம்',
  tea:              'டீ',
  dustbin_cleaning: 'குப்பைத்தொட்டி சுத்தம்',
  evening_cleaning: 'மாலை சுத்தம்',
  dustbin_checking: 'குப்பைத்தொட்டி சோதனை',
  shop_closing:     'கடை மூடுதல்',
  shop_opening:     'கடை திறத்தல்',
  purse_bag_stock:  'பர்ஸ், பை பங்கு',
  fan_cleaning:     'மின்விசிறி சுத்தம்',
  maadi_cleaning:   'மாடி சுத்தம்',
  pathiram_sl_box:  'பாத்திரம், எஸ்எல் பெட்டி',
};
function stockLabel(cat) {
  if (!cat) return '';
  return getLang() === 'ta' ? (STOCK_LABEL_TA[cat.id] || cat.label) : cat.label;
}

document.addEventListener('DOMContentLoaded', applyTranslations);

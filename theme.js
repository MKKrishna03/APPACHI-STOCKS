// theme.js — shared light/dark toggle, used by every page.
//
// Convention: the active theme is `document.documentElement.dataset.theme`,
// either "light" or "dark". Each page's CSS supplies its own colors for
// whichever theme ISN'T that page's default via `:root[data-theme="…"]`
// overrides — this file only handles which one is active and remembering
// the choice, not the colors themselves.
//
// Pages must inline-apply the saved theme at the very top of <head>, before
// any CSS loads, to avoid a flash of the wrong theme:
//   <script>document.documentElement.dataset.theme = localStorage.getItem('aj_theme') || 'DEFAULT';</script>
// where DEFAULT is whatever that page already looks like today (so anyone
// who has never toggled sees no change at all).
const THEME_KEY = 'aj_theme';

function _themeApplyIcon(theme) {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.innerHTML = theme === 'dark' ? '&#9728;' : '&#9790;';
  });
}

// The native Android status bar's icon color is fixed by the OS/theme
// config, not by our web CSS — so when the page flips to a light background,
// white status bar icons (meant for the dark theme) blend in and disappear.
// Flip the native bar to match whichever theme is actually showing.
function _themeSyncNativeStatusBar(theme) {
  const StatusBar = window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.StatusBar;
  if (!StatusBar) return;
  StatusBar.setStyle({ style: theme === 'dark' ? 'LIGHT' : 'DARK' }).catch(() => {});
  StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0d1117' : '#f2f0eb' }).catch(() => {});
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  _themeApplyIcon(next);
  _themeSyncNativeStatusBar(next);
}

document.addEventListener('DOMContentLoaded', () => {
  const theme = document.documentElement.dataset.theme;
  _themeApplyIcon(theme);
  _themeSyncNativeStatusBar(theme);
});

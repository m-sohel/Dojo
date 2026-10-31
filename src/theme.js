export const THEMES = ['slate', 'moss', 'dusk', 'sand'];
export const MODES = ['light', 'dark'];

const root = document.documentElement;

export function getTheme() {
  return THEMES.includes(root.dataset.theme) ? root.dataset.theme : 'slate';
}

export function getMode() {
  if (MODES.includes(root.dataset.mode)) return root.dataset.mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function persist(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not save the ${key} preference.`, error);
  }
}

function updateThemeColor() {
  const color = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) throw new RangeError(`Unknown Dojo theme: ${theme}`);
  root.dataset.theme = theme;
  persist('theme', theme);
  updateThemeColor();
}

export function setMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError(`Unknown Dojo color mode: ${mode}`);
  root.dataset.mode = mode;
  persist('mode', mode);
  updateThemeColor();
}

export function toggleMode() {
  setMode(getMode() === 'dark' ? 'light' : 'dark');
  return getMode();
}

updateThemeColor();

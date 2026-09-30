export type Theme = "light" | "dark";

const STORAGE_KEY = "impl.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in the document head, before the first paint: set from React after
 * hydration, the attribute would flash the light theme at every load of a
 * page the user wants dark.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light"}catch(e){}`;

export function storedTheme(): Theme | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    // Private windows and blocked site data both throw on access.
    return undefined;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setStoredTheme(theme: Theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice then only lasts for this page, which beats failing.
  }
}

/** Follows the system until the user picks a theme, then keeps that pick. */
export function followSystemTheme(onChange: (theme: Theme) => void) {
  const query = window.matchMedia(DARK_QUERY);
  const listener = () => {
    if (storedTheme()) return;
    applyTheme(systemTheme());
    onChange(systemTheme());
  };
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

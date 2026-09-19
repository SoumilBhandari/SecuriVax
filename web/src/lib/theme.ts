/** Light, dark, or whatever the device is set to. index.html applies it before the first paint. */
export type ThemePref = "light" | "dark" | "system";

const KEY = "securivax.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()): "light" | "dark" {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia?.(DARK_QUERY).matches);
  const theme = dark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b2545" : "#f5f8fa");
  return theme;
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  applyTheme(pref);
}

/** Follow the system's setting while the viewer hasn't picked one. */
export function followSystemTheme(): void {
  window.matchMedia?.(DARK_QUERY).addEventListener("change", () => {
    if (getThemePref() === "system") applyTheme("system");
  });
}

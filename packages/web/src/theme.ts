import type { ThemePreference } from "@markdown-mcp/shared";

export function applyTheme(pref: ThemePreference): void {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function cycleTheme(pref: ThemePreference): ThemePreference {
  const order: ThemePreference[] = ["light", "dark", "system"];
  return order[(order.indexOf(pref) + 1) % order.length]!;
}

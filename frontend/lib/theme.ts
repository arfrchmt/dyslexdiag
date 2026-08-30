export type AppTheme = "mit" | "minecraft" | "instagram";

export const appThemes: Array<{ value: AppTheme; label: string }> = [
  { value: "mit", label: "MIT style" },
  { value: "minecraft", label: "Minecraft style" },
  { value: "instagram", label: "Instagram style" }
];

export function getSavedTheme() {
  if (typeof window === "undefined") return "mit";
  return (window.localStorage.getItem("app-theme") as AppTheme | null) ?? "mit";
}

export function saveTheme(theme: AppTheme) {
  window.localStorage.setItem("app-theme", theme);
}

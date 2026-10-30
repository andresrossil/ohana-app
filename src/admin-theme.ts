export const adminDefault = {
  background: "#FFFFFF",
  secondary: "#F3F6FA",
  surface: "#FFFFFF",
  heading: "#233D5B",
  primary: "#285E97",
  text: "#233D5B",
  muted: "#60758D",
  border: "#DCE4ED",
  font: "Inter",
};
export type AdminTheme = typeof adminDefault;
export const fonts = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Lato",
  "Georgia",
];
export const themes: Record<string, AdminTheme> = {
  "Azul corporativo": adminDefault,
  Beige: {
    ...adminDefault,
    background: "#FBF8F3",
    secondary: "#F1E8DC",
    surface: "#FFFFFF",
    primary: "#725438",
    heading: "#493723",
    text: "#493723",
    muted: "#76634F",
    border: "#DCCFBE",
  },
  Verde: {
    ...adminDefault,
    background: "#FFFFFF",
    secondary: "#EFF6F1",
    primary: "#28704D",
    heading: "#214B38",
    text: "#254B38",
    muted: "#5C7567",
    border: "#D5E5DB",
  },
  Morado: {
    ...adminDefault,
    secondary: "#F5F1FA",
    primary: "#7545A2",
    heading: "#4D316B",
    text: "#443451",
    muted: "#786587",
    border: "#E4DAED",
  },
  Oscuro: {
    ...adminDefault,
    background: "#111827",
    secondary: "#182235",
    surface: "#1F2B40",
    primary: "#8DBBFA",
    heading: "#F3F6FA",
    text: "#E5EBF3",
    muted: "#ACBBD0",
    border: "#44546A",
  },
};
export function normalizeAdminTheme(
  value: Record<string, unknown> = {},
): AdminTheme {
  const result = { ...adminDefault };
  for (const key of Object.keys(result) as (keyof AdminTheme)[]) {
    const v = value[key];
    if (
      typeof v === "string" &&
      (key === "font" ? fonts.includes(v) : /^#[0-9a-f]{6}$/i.test(v))
    )
      result[key] = v;
  }
  return result;
}
function luminance(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((s) => parseInt(s, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function buttonText(theme: AdminTheme) {
  return contrast(theme.primary, "#FFFFFF") >=
    contrast(theme.primary, "#000000")
    ? "#FFFFFF"
    : "#000000";
}
export function contrastIssues(t: AdminTheme) {
  return [
    ["Texto sobre fondo", t.text, t.background],
    ["Texto sobre superficie", t.text, t.surface],
    ["Texto secundario sobre fondo", t.muted, t.background],
    ["Texto secundario sobre superficie", t.muted, t.surface],
    ["Texto sobre fondo secundario", t.text, t.secondary],
    ["Títulos sobre fondo", t.heading, t.background],
    ["Títulos sobre superficie", t.heading, t.surface],
    ["Títulos sobre fondo secundario", t.heading, t.secondary],
  ]
    .filter(([, a, b]) => contrast(a, b) < 4.5)
    .map(([label]) => label);
}
export function adminVariables(t: AdminTheme) {
  return {
    ...Object.fromEntries(
      Object.entries(t).map(([k, v]) => ["--admin-" + k, v]),
    ),
    "--admin-button-text": buttonText(t),
    "--company-background": t.background,
    "--company-surface": t.surface,
    "--company-primary": t.primary,
    "--company-text": t.text,
    "--company-accent": t.secondary,
    "--company-font": t.font,
    "--company-heading": t.font,
  };
}

export const C = {
  navy: "#0B1F33",
  navy2: "#133a5c",
  ink: "#F4F7FA",
  orange: "#F26A3D",
  blue: "#6FB4E8",
  dim: "#9FB6C9",
  figOff: "#2E5C80",
};
export const FONT = "'Carlito', Arial, sans-serif";
export const FONT_B = "'Carlito Bold', Arial, sans-serif";
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const easeOut = (x: number) => { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
export const fade = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

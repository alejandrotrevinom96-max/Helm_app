// Design tokens — reference. The values that ship to the browser live in
// CSS variables in app/globals.css; this file mirrors them so any TS code
// that wants to read a token (e.g. inline styles, Recharts colors, etc.)
// stays in sync with the stylesheet.

export const lightTheme = {
  bg: 'oklch(98% 0.005 80)',
  bgElev: 'oklch(96% 0.005 80)',
  surface1: 'rgba(255, 255, 255, 0.6)',
  surface2: 'rgba(255, 255, 255, 0.85)',
  border: 'oklch(88% 0.005 80)',
  borderBright: 'oklch(80% 0.005 80)',
  text1: 'oklch(15% 0 0)',
  text2: 'oklch(40% 0 0)',
  text3: 'oklch(60% 0 0)',
  accent: '#C44520',
  accentHover: '#A83A1B',
  accentSoft: 'rgba(196, 69, 32, 0.06)',
  accentGlow: 'rgba(196, 69, 32, 0.2)',
  accentGrad: 'linear-gradient(135deg, #C44520 0%, #E8593F 100%)',
  success: 'oklch(50% 0.15 145)',
  successSoft: 'rgba(34, 139, 34, 0.08)',
  danger: 'oklch(50% 0.20 25)',
  shadow1: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
  shadow2: '0 4px 16px rgba(0,0,0,0.06), 0 16px 48px rgba(0,0,0,0.08)',
  shadowGlass: '0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 32px rgba(0,0,0,0.06)',
};

export const darkTheme = {
  bg: 'oklch(15% 0 0)',
  bgElev: 'oklch(18% 0 0)',
  surface1: 'rgba(255, 255, 255, 0.04)',
  surface2: 'rgba(255, 255, 255, 0.08)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderBright: 'rgba(255, 255, 255, 0.18)',
  text1: 'oklch(98% 0 0)',
  text2: 'oklch(75% 0 0)',
  text3: 'oklch(50% 0 0)',
  accent: '#E8593F',
  accentHover: '#FF6B47',
  accentSoft: 'rgba(232, 89, 63, 0.08)',
  accentGlow: 'rgba(232, 89, 63, 0.4)',
  accentGrad: 'linear-gradient(135deg, #E8593F 0%, #FF8E53 100%)',
  success: 'oklch(72% 0.18 145)',
  successSoft: 'rgba(74, 222, 128, 0.1)',
  danger: 'oklch(65% 0.22 25)',
  shadow1: '0 1px 2px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.4)',
  shadow2: '0 4px 16px rgba(0,0,0,0.4), 0 16px 48px rgba(0,0,0,0.6)',
  shadowGlass:
    '0 1px 0 rgba(255,255,255,0.05) inset, 0 -1px 0 rgba(0,0,0,0.3) inset, 0 8px 32px rgba(0,0,0,0.4)',
};

export type Theme = 'light' | 'dark';

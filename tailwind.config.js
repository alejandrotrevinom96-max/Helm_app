/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        'bg-elev': '#111111',
        'bg-card': '#161616',
        'bg-hover': '#1c1c1c',
        border: '#262626',
        'border-bright': '#404040',
        text: '#fafafa',
        'text-dim': '#a3a3a3',
        'text-faint': '#525252',
        accent: '#ff6b35',
        'accent-soft': 'rgba(255, 107, 53, 0.08)',
        'accent-glow': 'rgba(255, 107, 53, 0.4)',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

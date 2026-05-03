/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
        },
        border: {
          DEFAULT: 'var(--border)',
          bright: 'var(--border-bright)',
        },
        text: {
          1: 'var(--text-1)',
          2: 'var(--text-2)',
          3: 'var(--text-3)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          glow: 'var(--accent-glow)',
        },
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        danger: 'var(--danger)',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'display-xl': [
          'clamp(3rem, 8vw, 7rem)',
          { lineHeight: '0.95', letterSpacing: '-0.03em' },
        ],
        'display-lg': [
          'clamp(2.5rem, 6vw, 5rem)',
          { lineHeight: '1', letterSpacing: '-0.025em' },
        ],
        'display-md': [
          'clamp(2rem, 4vw, 3rem)',
          { lineHeight: '1.1', letterSpacing: '-0.02em' },
        ],
        metric: [
          'clamp(2.5rem, 5vw, 3.5rem)',
          { lineHeight: '1', letterSpacing: '-0.02em' },
        ],
      },
      boxShadow: {
        editorial: 'var(--shadow-1)',
        'editorial-lg': 'var(--shadow-2)',
        glass: 'var(--shadow-glass)',
      },
      backdropBlur: {
        glass: '20px',
      },
      animation: {
        'theme-fade': 'fade 0.4s ease',
      },
    },
  },
  plugins: [],
};

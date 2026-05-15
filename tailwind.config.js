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
        // PR Sprint 7.25 Phase 1 — per-page accent palette from the
        // platform redesign. Each platform page in the design spec
        // keys its glow + chips to one of these. Exposed as Tailwind
        // colors so the migrated pages can use them as
        // bg-d-blue / text-d-blue / border-d-blue / etc. The "2"
        // variant is the lighter companion (e.g., for hover or
        // light-on-dark text on a tinted background).
        'd-blue': {
          DEFAULT: 'var(--d-blue)',
          2: 'var(--d-blue-2)',
        },
        'd-orange': {
          DEFAULT: 'var(--d-orange)',
          2: 'var(--d-orange-2)',
        },
        'd-purple': {
          DEFAULT: 'var(--d-purple)',
          2: 'var(--d-purple-2)',
        },
        'd-green': {
          DEFAULT: 'var(--d-green)',
          2: 'var(--d-green-2)',
        },
        'd-red': {
          DEFAULT: 'var(--d-red)',
          2: 'var(--d-red-2)',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        // PR Sprint 7.25 Phase 1 — platform redesign families.
        // `instrument` is the heading serif used on every platform
        // page's huge h1 (the 88px italic display text). `jakarta`
        // is the platform body sans — slightly more geometric than
        // Geist and used heavily in the platform shells (sidebar,
        // cards). Existing pages keep using `display` (Fraunces)
        // and `sans` (Geist) until migrated.
        instrument: ['"Instrument Serif"', 'Georgia', 'serif'],
        jakarta: ['"Plus Jakarta Sans"', '"Geist"', 'system-ui', 'sans-serif'],
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

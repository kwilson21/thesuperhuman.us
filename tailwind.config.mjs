/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        rule: 'var(--rule)',
        accent: 'var(--accent)',
      },
      fontFamily: {
        serif: ['"Newsreader Variable"', 'Newsreader', 'Iowan Old Style', 'Georgia', 'serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      maxWidth: {
        measure: '38rem',
        content: '42.5rem',
        page: '64rem',
      },
      letterSpacing: {
        eyebrow: '0.12em',
      },
    },
  },
  plugins: [],
};

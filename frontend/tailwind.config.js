/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['Consolas', 'monospace'] },
      colors: { background: 'var(--background)', surface: 'var(--surface)', elevated: 'var(--elevated)', sidebar: 'var(--sidebar)', border: 'var(--border)', borderStrong: 'var(--border-strong)', focus: 'var(--focus)', accent: 'var(--accent)', danger: 'var(--danger)', success: 'var(--success)', warning: 'var(--warning)' },
      borderRadius: { panel: 'var(--radius)', sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', pill: 'var(--radius-pill)' },
      spacing: { 1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)', 4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)', 7: 'var(--space-7)', 8: 'var(--space-8)' },
      boxShadow: { dialog: 'var(--shadow-dialog)', drawer: 'var(--shadow-drawer)' },
      transitionTimingFunction: { standard: 'var(--ease-standard)' },
    },
  },
  plugins: [],
};

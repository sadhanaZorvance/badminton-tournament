import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0E1B2E',
          light: '#162436',
          dark: '#090F1A',
        },
        gold: {
          DEFAULT: '#C9A84C',
          bright: '#F0C040',
          muted: '#8B6914',
        },
        slate: {
          DEFAULT: '#8899AA',
          light: '#AAB8C4',
        },
        amber: {
          warning: '#F59E0B',
        },
        error: {
          DEFAULT: '#EF4444',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      keyframes: {
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(240, 192, 64, 0.6)' },
          '50%': { boxShadow: '0 0 0 6px rgba(240, 192, 64, 0)' },
        },
        'slide-up-fade': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'pulse-gold': 'pulse-gold 1.6s ease-in-out infinite',
        'slide-up-fade': 'slide-up-fade 400ms ease-out',
        shake: 'shake 300ms ease-in-out',
      },
    },
  },
  plugins: [],
};

export default config;

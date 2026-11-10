/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0d10',
        panel: '#14171c',
        panel2: '#1c2027',
        line: '#2a2f38',
        accent: '#2f7bff',
        accent2: '#5b9bff',
      },
    },
  },
  plugins: [],
};

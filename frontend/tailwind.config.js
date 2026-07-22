/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        estrada: {
          orange: '#F7941D',
          red: '#EE3124',
          navy: '#1B2A4A',
          navyLight: '#2C3E63',
          gray: '#6B7280',
        },
      },
      backgroundImage: {
        'estrada-gradient': 'linear-gradient(90deg, #F7941D 0%, #EE3124 100%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

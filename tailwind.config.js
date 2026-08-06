/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand-dark': '#1C2333',
        'brand-gold': '#C9A46A',
        'brand-cream': '#F7F5F1',
        'brand-warm': '#FBF1E1',
        'brand-border': '#E8E2D5',
        'brand-text': '#5A5445',
        'brand-success': '#3D7A5C',
        'brand-warning': '#B8863B',
        'brand-danger': '#B84C3D',
      }
    },
  },
  plugins: [],
}
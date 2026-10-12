/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(240 10% 3.9%)',
        foreground: 'hsl(0 0% 98%)',
        border: 'hsl(240 3.7% 15.9%)',
        primary: 'hsl(217 91% 60%)',
        secondary: 'hsl(240 3.7% 15.9%)',
        muted: 'hsl(240 3.7% 15.9%)',
        'muted-foreground': 'hsl(240 5% 64.9%)',
        card: 'hsl(240 10% 3.9%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    base: '/web-kingdom-of-stone/',
    plugins: [tailwindcss()]
});

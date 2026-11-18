import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ root: 'client', plugins: [react(), tailwindcss()], build: { outDir: '../dist/client', emptyOutDir: true, rollupOptions: { output: { manualChunks: { charts: ['recharts'], forms: ['react-hook-form', 'zod', '@hookform/resolvers/zod'] } } } } });

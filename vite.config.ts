import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteExternalsPlugin } from 'vite-plugin-externals';

const compilerOptions = {
  isCustomElement: (tag: string) => tag.startsWith('forum-')
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({ template: { compilerOptions } }),
    viteExternalsPlugin({
      '@beblurt/dblurt': 'dblurt',
    }),
  ],

  // Set base to './' for local file serving, or override with VITE_BASE env var.
  // GitHub Pages deploys to /<repo-name>/ so the workflow sets base via env.
  base: process.env.VITE_BASE ?? './',

  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: () => 'index.js',
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
});

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
const compilerOptions = {
    isCustomElement: (tag) => tag.startsWith('forum-')
};
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [vue({ template: { compilerOptions } })],
    // Set base to './' for local file serving, or override with VITE_BASE env var.
    // GitHub Pages deploys to /<repo-name>/ so the workflow sets base via env.
    base: process.env.VITE_BASE ?? './',
    build: {
        outDir: 'dist',
        // dblurt and PeerTube embed API are loaded from CDN and exposed as globals.
        // Marking them as externals would prevent bundling; instead we rely on the
        // CDN <script> tags in index.html and declare them as globals in env.d.ts.
    },
});

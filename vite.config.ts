import { defineConfig } from "vite";
import { resolve } from "path";

// Owlbear Rodeo (https://www.owlbear.rodeo) fetches the manifest and the
// badge image from its own origin, so every response must allow cross-origin
// access — both from the dev server and in production (see netlify.toml).
// Recent Vite versions restrict CORS to localhost by default, which is why
// local testing inside Owlbear Rodeo fails without this.
const corsHeaders = { "Access-Control-Allow-Origin": "*" };

export default defineConfig({
  server: {
    cors: true,
    headers: corsHeaders,
  },
  preview: {
    cors: true,
    headers: corsHeaders,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.html"),
        action: resolve(__dirname, "action.html"),
        loot: resolve(__dirname, "loot.html"),
        document: resolve(__dirname, "document.html"),
        editor: resolve(__dirname, "editor.html"),
        inventory: resolve(__dirname, "inventory.html"),
        lootLog: resolve(__dirname, "loot-log.html"),
      },
    },
  },
});

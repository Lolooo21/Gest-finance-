/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// L'API est proxifiée sur la même origine : les cookies HttpOnly/SameSite=Strict fonctionnent sans CORS.
const API = process.env.API_URL ?? "http://localhost:3000";
const apiRoutes = ["/auth", "/household", "/accounts", "/transactions", "/recurring-rules", "/summary", "/health"];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Gest-finance",
        short_name: "Finances",
        description: "Gestion des finances du foyer",
        theme_color: "#0f766e",
        background_color: "#f8fafc",
        display: "standalone",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      // Les appels à l'API ne sont jamais mis en cache : données financières sensibles.
      workbox: { importScripts: ["push-sw.js"], navigateFallbackDenylist: apiRoutes.map((r) => new RegExp(`^${r}`)) },
    }),
  ],
  server: { proxy: Object.fromEntries(apiRoutes.map((r) => [r, API])) },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
declare const process: { env: Record<string, string | undefined> };
const version = process.env.GITHUB_SHA || "local-" + Date.now();
export default defineConfig({
  plugins: [
    react(),
    {
      name: "ohana-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ id: version }),
        });
      },
    },
  ],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
  base: "/ohana-app/",
});

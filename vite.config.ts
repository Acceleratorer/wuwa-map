import { defineConfig } from "vite";

export default defineConfig({
  base: "/wuwa-map/",
  server: {
    proxy: {
      "/wuwa-map/api": {
        target: "http://127.0.0.1:8787",
      },
    },
  },
});

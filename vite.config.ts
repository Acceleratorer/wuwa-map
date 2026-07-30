import { defineConfig } from "vite";

export default defineConfig({
  base: "/wuwa_map/",
  server: {
    proxy: {
      "/wuwa_map/api": {
        target: "http://127.0.0.1:8787",
      },
    },
  },
});

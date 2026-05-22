import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [nitro()],
  tanstackStart: {
    server: { entry: "server" },
  },
});

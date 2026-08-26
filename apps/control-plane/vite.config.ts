import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
        emptyOutDir: true,
        outDir: "../../.build/client/control-plane",
        sourcemap: true,
        lib: {
            entry: "client/main.tsx",
            formats: ["es"],
            fileName: () => "openbot-client.js",
        },
        rollupOptions: {
            output: {
                assetFileNames: "openbot-client[extname]",
            },
        },
    },
});

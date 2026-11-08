import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const lucideImport = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g;

function lucideIconFile(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function lucideDirectImports(): Plugin {
  return {
    name: "lucide-direct-imports",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("node_modules") || !code.includes("lucide-react")) return null;
      let changed = false;
      const next = code.replace(lucideImport, (_full, specifiers: string) => specifiers.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
        const [imported, alias] = part.split(/\s+as\s+/);
        const name = imported?.trim();
        if (!name) return "";
        changed = true;
        return `import ${alias?.trim() || name} from "lucide-react/dist/esm/icons/${lucideIconFile(name)}.mjs";`;
      }).join("\n"));
      return changed ? { code: next, map: null } : null;
    },
  };
}

export default defineConfig({
  plugins: [lucideDirectImports(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "react";
          if (id.includes("node_modules/react-router")) return "router";
          if (id.includes("node_modules/@tanstack/react-query")) return "query";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/media": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
  preview: { host: true, port: 4173 },
});

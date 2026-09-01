import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Public backend connection values (protected by RLS). Used as a build-time
// fallback so a build without a .env still produces a working bundle instead
// of crashing with "supabaseUrl is required".
const FALLBACK_SUPABASE_URL = "https://yqxmtxivimuqowxuqumr.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxeG10eGl2aW11cW93eHVxdW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNjU2NTgsImV4cCI6MjA5MTg0MTY1OH0.P9EHyir1XX8uTJX-7TkFz6OyGJdkJ5OyVaZ-V1RoB68";
const FALLBACK_SUPABASE_PROJECT_ID = "yqxmtxivimuqowxuqumr";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const key =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;
  const projectId =
    env.VITE_SUPABASE_PROJECT_ID || process.env.VITE_SUPABASE_PROJECT_ID || FALLBACK_SUPABASE_PROJECT_ID;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(projectId),
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});


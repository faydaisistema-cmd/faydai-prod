import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Projeto isolado — deployado como um Vercel Project separado apontando
// para apps/admin como Root Directory (ver deploy-checklist.md, Fase 4.5).
export default defineConfig({
  plugins: [react()],
});

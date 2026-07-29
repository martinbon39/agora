import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import { AuthGate } from "./auth/AuthGate";
import { ThemeProvider } from "./theme";
import "./index.css";

// a redeploy invalidates the open tab's hashed chunks — reload instead of dying
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <AuthGate>
      <App />
    </AuthGate>
    <Toaster position="top-right" theme="system" richColors closeButton />
  </ThemeProvider>
);

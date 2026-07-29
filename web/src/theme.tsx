import { createContext, useContext, useEffect, type ReactNode } from "react";

/** agora is dark-only — the provider survives as a stable API. */
const ThemeContext = createContext<{ dark: boolean }>({ dark: true });

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#131110");
  }, []);
  return <ThemeContext.Provider value={{ dark: true }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

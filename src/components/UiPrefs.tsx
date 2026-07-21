"use client";

/**
 * UI preferences: interface layout (modern sidebar vs classic top bar) and
 * sidebar collapsed state. Persisted to localStorage. Default = modern.
 * Server and first client render both use the defaults, so there is no
 * hydration mismatch; the stored choice is applied on mount.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Layout = "modern" | "classic";

interface UiPrefsState {
  layout: Layout;
  setLayout: (l: Layout) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  ready: boolean;
}

const UiCtx = createContext<UiPrefsState>({
  layout: "modern",
  setLayout: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
  ready: false,
});

export function useUiPrefs() {
  return useContext(UiCtx);
}

const LS_LAYOUT = "sarai.layout";
const LS_SIDEBAR = "sarai.sidebar";

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [layout, setLayoutState] = useState<Layout>("modern");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const l = localStorage.getItem(LS_LAYOUT);
      if (l === "modern" || l === "classic") setLayoutState(l);
      setSidebarCollapsed(localStorage.getItem(LS_SIDEBAR) === "1");
    } catch {
      /* ignore storage errors */
    }
    setReady(true);
  }, []);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LS_LAYOUT, l);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(LS_SIDEBAR, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <UiCtx.Provider value={{ layout, setLayout, sidebarCollapsed, toggleSidebar, ready }}>
      {children}
    </UiCtx.Provider>
  );
}

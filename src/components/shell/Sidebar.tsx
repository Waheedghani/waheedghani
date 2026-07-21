"use client";

/**
 * Modern layout: dark corporate left sidebar. Collapsible module groups with
 * icons, active highlighting, and a footer holding the user, the Classic/
 * Modern switch and sign out. Collapses to an icon rail. Bilingual + RTL-safe.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navForRole, type NavModule } from "@/lib/nav";
import { L } from "@/components/L";
import { labels } from "@/lib/labels";
import { useAuth } from "@/components/AuthProvider";
import { useUiPrefs } from "@/components/UiPrefs";
import { ModuleIcon } from "@/components/shell/icons";
import { LayoutToggle } from "@/components/shell/LayoutToggle";

function isModuleActive(m: NavModule, pathname: string): boolean {
  if (m.href === "/") return pathname === "/";
  if (pathname === m.href || pathname.startsWith(m.href + "/")) return true;
  return m.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
}

export function Sidebar() {
  const { profile, signOut } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useUiPrefs();
  const pathname = usePathname();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const modules = profile ? navForRole(profile.role) : [];

  // auto-open the group containing the active route
  useEffect(() => {
    const active = modules.find((m) => m.items.length > 1 && isModuleActive(m, pathname));
    if (active) setOpenKey(active.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, profile?.role]);

  if (!profile) return null;
  const collapsed = sidebarCollapsed;

  return (
    <aside
      className={`no-print shrink-0 bg-header text-header-text flex flex-col h-screen sticky top-0 transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      {/* brand */}
      <div className={`h-12 flex items-center gap-2 border-b border-white/10 ${collapsed ? "justify-center px-0" : "px-3"}`}>
        <div className="w-7 h-7 rounded-[5px] bg-accent text-white grid place-items-center font-bold text-sm shrink-0">
          و
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white leading-tight truncate">{labels.app_name.en}</div>
            <div dir="rtl" lang="ps" className="font-pashto text-xs text-header-text/80 leading-tight truncate">
              {labels.app_name.ps}
            </div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <ul className="space-y-0.5 px-1.5">
          {modules.map((m) => {
            const active = isModuleActive(m, pathname);
            const hasChildren = m.items.length > 1;

            if (collapsed || !hasChildren) {
              return (
                <li key={m.key}>
                  <Link
                    href={m.href}
                    title={`${labels[m.key].en} / ${labels[m.key].ps}`}
                    className={`flex items-center gap-2.5 h-9 rounded-[5px] px-2.5 ${
                      collapsed ? "justify-center px-0" : ""
                    } ${active ? "bg-accent text-white" : "text-header-text/85 hover:bg-white/10 hover:text-white"}`}
                  >
                    <ModuleIcon k={m.key} className="shrink-0" />
                    {!collapsed && (
                      <span className="truncate">
                        <L k={m.key} />
                      </span>
                    )}
                  </Link>
                </li>
              );
            }

            const open = openKey === m.key;
            return (
              <li key={m.key}>
                <button
                  onClick={() => setOpenKey(open ? null : m.key)}
                  className={`w-full flex items-center gap-2.5 h-9 rounded-[5px] px-2.5 ${
                    active ? "text-white" : "text-header-text/85 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <ModuleIcon k={m.key} className="shrink-0" />
                  <span className="truncate flex-1 text-left">
                    <L k={m.key} />
                  </span>
                  <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? "rotate-90" : ""}`}>
                    <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {open && (
                  <ul className="mt-0.5 mb-1 ml-4 pl-2 border-l border-white/10 space-y-0.5">
                    {m.items.map((item) => {
                      const iActive = pathname === item.href || pathname.startsWith(item.href + "/");
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`block h-8 leading-8 rounded-[5px] px-2.5 truncate ${
                              iActive ? "bg-accent text-white" : "text-header-text/75 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <L k={item.key} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* footer: collapse, layout toggle, user, sign out */}
      <div className="border-t border-white/10 p-2 space-y-2">
        <button
          onClick={toggleSidebar}
          title={collapsed ? `${labels.expand_menu.en}` : `${labels.collapse_menu.en}`}
          className={`flex items-center gap-2 h-8 rounded-[5px] text-header-text/70 hover:bg-white/10 hover:text-white w-full ${
            collapsed ? "justify-center" : "px-2.5"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
          </svg>
          {!collapsed && <span className="text-xs"><L k="collapse_menu" /></span>}
        </button>

        {!collapsed && (
          <>
            <LayoutToggle tone="dark" />
            <div className="text-xs text-header-text/80 px-1 truncate">
              {profile.full_name}
              <span className="text-header-text/50">
                {" · "}
                {labels[profile.role === "warehouse" ? "warehouse_role" : profile.role === "admin" ? "admin" : "office"].en}
              </span>
            </div>
          </>
        )}
        <button
          onClick={() => void signOut()}
          title={`${labels.sign_out.en} / ${labels.sign_out.ps}`}
          className={`flex items-center gap-2 h-8 rounded-[5px] border border-white/20 hover:bg-white/10 w-full ${
            collapsed ? "justify-center" : "px-2.5"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 12H3m0 0 4-4m-4 4 4 4M13 4h6v16h-6" />
          </svg>
          {!collapsed && <span className="text-xs"><L k="sign_out" /></span>}
        </button>
      </div>
    </aside>
  );
}

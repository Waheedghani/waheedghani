"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { navForRole } from "@/lib/nav";
import { L } from "@/components/L";
import { labels } from "@/lib/labels";
import { useAuth } from "@/components/AuthProvider";

/**
 * Dark corporate top module bar with dropdown submenus (spec §10.1).
 */
export function ModuleBar() {
  const { profile, signOut } = useAuth();
  const pathname = usePathname();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenKey(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => setOpenKey(null), [pathname]);

  if (!profile) return null;
  const modules = navForRole(profile.role);

  return (
    <nav ref={barRef} className="bg-header text-header-text no-print select-none">
      <div className="flex items-stretch h-10">
        <div className="flex items-center gap-2 px-3 border-r border-white/10">
          <span className="font-semibold text-sm tracking-wide text-white">
            {labels.app_name.en}
          </span>
          <span dir="rtl" lang="ps" className="font-pashto text-sm text-header-text/90">
            {labels.app_name.ps}
          </span>
        </div>

        <ul className="flex items-stretch">
          {modules.map((m) => {
            const active =
              pathname === m.href ||
              (m.href !== "/" && pathname.startsWith(m.href.split("/").slice(0, 2).join("/"))) ||
              m.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
            const hasMenu = m.items.length > 1;
            return (
              <li key={m.key} className="relative flex">
                {hasMenu ? (
                  <button
                    className={`px-3 flex items-center gap-1 text-[12.5px] hover:bg-header-hover ${
                      active ? "bg-header-active text-white" : ""
                    }`}
                    onClick={() => setOpenKey(openKey === m.key ? null : m.key)}
                    onMouseEnter={() => openKey !== null && setOpenKey(m.key)}
                  >
                    <L k={m.key} />
                    <svg width="8" height="8" viewBox="0 0 8 8" className="opacity-70">
                      <path d="M0 2l4 4 4-4z" fill="currentColor" />
                    </svg>
                  </button>
                ) : (
                  <Link
                    href={m.href}
                    className={`px-3 flex items-center text-[12.5px] hover:bg-header-hover ${
                      active ? "bg-header-active text-white" : ""
                    }`}
                  >
                    <L k={m.key} />
                  </Link>
                )}
                {hasMenu && openKey === m.key && (
                  <ul className="absolute top-full left-0 z-50 min-w-56 bg-white border border-line shadow-lg py-1">
                    {m.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`block px-3 py-1.5 text-ink hover:bg-accent-soft ${
                            pathname === item.href ? "bg-accent-soft font-medium" : ""
                          }`}
                        >
                          <L k={item.key} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-3 px-3 text-xs">
          <span className="text-header-text/80">
            {profile.full_name} · <L k={profile.role === "warehouse" ? "warehouse_role" : profile.role === "admin" ? "admin" : "office"} />
          </span>
          <button
            onClick={() => void signOut()}
            className="border border-white/25 px-2 h-6 rounded-[2px] hover:bg-header-hover"
          >
            <L k="sign_out" />
          </button>
        </div>
      </div>
    </nav>
  );
}

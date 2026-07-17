"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { ModuleBar } from "@/components/shell/ModuleBar";
import { GlobalSearch } from "@/components/shell/GlobalSearch";
import { useAuth } from "@/components/AuthProvider";
import { L } from "@/components/L";
import { labels, type LabelKey } from "@/lib/labels";
import { NAV } from "@/lib/nav";

function crumbsFor(pathname: string): Array<{ label: LabelKey | string; href?: string }> {
  for (const m of NAV) {
    for (const item of m.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        const crumbs: Array<{ label: LabelKey | string; href?: string }> = [
          { label: m.key, href: m.href },
        ];
        if (item.key !== m.key) crumbs.push({ label: item.key, href: item.href });
        if (pathname !== item.href) crumbs.push({ label: pathname.split("/").pop() ?? "" });
        return crumbs;
      }
    }
    if (pathname === m.href) return [{ label: m.key }];
  }
  return [];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, profileMissing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (profile?.role === "warehouse" && !pathname.startsWith("/portal")) {
      router.replace("/portal");
    }
  }, [loading, session, profile, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-soft">
        <L k="loading" />
      </div>
    );
  }

  if (!session) return null;

  if (profileMissing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="panel p-6 max-w-md text-center space-y-3">
          <div className="text-lg font-semibold">
            <L k="no_profile" />
          </div>
          <Link className="btn-secondary inline-flex" href="/login">
            <L k="back" />
          </Link>
        </div>
      </div>
    );
  }

  const crumbs = crumbsFor(pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <ModuleBar />
      <div className="bg-white border-b border-line px-3 h-9 flex items-center gap-3 no-print">
        <nav className="flex items-center gap-1.5 text-ink-soft min-w-0">
          <Link href={profile?.role === "warehouse" ? "/portal" : "/"} className="hover:text-accent">
            <L k="home" />
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              <span className="text-line-strong">›</span>
              {c.href && i < crumbs.length - 1 ? (
                <Link href={c.href} className="hover:text-accent truncate">
                  {typeof c.label === "string" && !(c.label in labels) ? (
                    <span className="font-mono text-xs">{c.label}</span>
                  ) : (
                    <L k={c.label as LabelKey} />
                  )}
                </Link>
              ) : typeof c.label === "string" && !(c.label in labels) ? (
                <span className="font-mono text-xs truncate">{c.label}</span>
              ) : (
                <span className="text-ink font-medium">
                  <L k={c.label as LabelKey} />
                </span>
              )}
            </span>
          ))}
        </nav>
        <div className="ml-auto">
          <GlobalSearch />
        </div>
      </div>
      <main className="flex-1 p-3 print-page">{children}</main>
    </div>
  );
}

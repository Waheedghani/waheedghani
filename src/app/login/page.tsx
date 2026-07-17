"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { L } from "@/components/L";
import { labels, lbl } from "@/lib/labels";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { reloadProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabase();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) {
      setError(lbl("login_failed"));
      setBusy(false);
      return;
    }
    try {
      await sb.rpc("fn_log_auth_event", {
        p_event_type: "login",
        p_user_agent: navigator.userAgent,
      });
    } catch {
      /* non-blocking */
    }
    // Does this auth user have a profile? If not, offer first-run bootstrap.
    const { data: me } = await sb.auth.getUser();
    const { data: prof } = await sb
      .from("app_users")
      .select("id")
      .eq("id", me.user?.id ?? "")
      .maybeSingle();
    if (!prof) {
      setNeedsBootstrap(true);
      setBusy(false);
      return;
    }
    await reloadProfile();
    router.replace("/");
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().rpc("fn_bootstrap_admin", {
      p_full_name: fullName,
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    await reloadProfile();
    router.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="panel w-96 p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="text-xl font-semibold text-header">
            {labels.app_name.en}{" "}
            <span dir="rtl" lang="ps" className="font-pashto">
              {labels.app_name.ps}
            </span>
          </div>
          <div className="text-ink-soft text-sm">
            <L k="app_subtitle" />
          </div>
        </div>

        {!needsBootstrap ? (
          <form onSubmit={handleSignIn} className="space-y-3">
            <div className="field">
              <label className="field-label" htmlFor="email">
                <L k="email" />
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">
                <L k="password" />
              </label>
              <input
                id="password"
                type="password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <div className="text-status-reversed text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
              <L k="sign_in" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleBootstrap} className="space-y-3">
            <div className="text-sm font-medium">
              <L k="bootstrap_admin_title" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="fullName">
                <L k="full_name" />
              </label>
              <input
                id="fullName"
                required
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            {error && <div className="text-status-reversed text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
              <L k="create" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

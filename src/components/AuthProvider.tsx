"use client";

/**
 * Session + profile context. The client renders what the role allows, but the
 * actual security boundary is Postgres RLS — a tampered client still cannot
 * read or write anything beyond its role.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";

interface AuthState {
  session: Session | null;
  profile: AppUser | null;
  loading: boolean;
  profileMissing: boolean;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  profileMissing: false,
  signOut: async () => {},
  reloadProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileMissing, setProfileMissing] = useState(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setProfileMissing(false);
      return;
    }
    const { data, error } = await supabase()
      .from("app_users")
      .select("id, full_name, role, warehouse_id, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data || !data.is_active) {
      setProfile(null);
      setProfileMissing(true);
    } else {
      setProfile(data as AppUser);
      setProfileMissing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        await loadProfile(data.session?.user.id);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase().auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return;
      setSession(s);
      await loadProfile(s?.user.id);
      setLoading(false);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    try {
      await supabase().rpc("fn_log_auth_event", {
        p_event_type: "logout",
        p_user_agent: navigator.userAgent,
      });
    } catch {
      /* logging must never block sign-out */
    }
    await supabase().auth.signOut();
  }, []);

  const reloadProfile = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    await loadProfile(data.session?.user.id);
  }, [loadProfile]);

  return (
    <AuthCtx.Provider value={{ session, profile, loading, profileMissing, signOut, reloadProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}

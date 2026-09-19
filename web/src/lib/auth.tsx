import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import type { User } from "../types";
import { api, SIGN_IN_EVENT } from "./api";
import { SNAPSHOT } from "./snapshot";

// Looking at anything needs no account (a judge's own phone, a sticker tap on
// any phone). Changing things (loading a box, a VVM check, acting on the
// agent's advice, a stage reset) needs an operator account.

interface Auth {
  user: User | null;
  ready: boolean; // false until we know whether anyone is signed in
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (b: { email: string; password: string; name: string; operator_code: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(Boolean(SNAPSHOT));
  const navigate = useNavigate();

  useEffect(() => {
    if (SNAPSHOT) return;
    api.auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // A change the server refused for want of a sign-in (say, an expired
  // session): sign in, then come back to the same page.
  useEffect(() => {
    const onNeed = () => {
      setUser(null);
      navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    };
    window.addEventListener(SIGN_IN_EVENT, onNeed);
    return () => window.removeEventListener(SIGN_IN_EVENT, onNeed);
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string) => setUser((await api.auth.login(email, password)).user), []);
  const signUp = useCallback(async (b: Parameters<Auth["signUp"]>[0]) => setUser((await api.auth.register(b)).user), []);
  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signUp, signOut }), [user, ready, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}

/**
 * Before a change: if nobody is signed in, go to sign-in (and come back to
 * `next`, this page by default) and return true, so the caller stops there.
 */
export function useSignInFirst(): (next?: string) => boolean {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (next?: string) => {
      if (SNAPSHOT || user) return false; // signed in: the server still checks the role
      navigate(`/login?next=${encodeURIComponent(next ?? pathname + search)}`);
      return true;
    },
    [user, navigate, pathname, search],
  );
}

/** Where to go after signing in: only a path on this site, never another origin. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/boxes";
}

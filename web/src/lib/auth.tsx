import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import type { User } from "../types";
import { api } from "./api";
import { SNAPSHOT } from "./snapshot";

interface Auth {
  user: User | null;
  ready: boolean; // false until we know whether anyone is signed in
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (b: { email: string; password: string; name: string; operator_code: string }) => Promise<void>;
  demo: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);
// A snapshot has no server to sign in to: it opens as the demo viewer.
const SNAPSHOT_USER: User = { id: 0, email: null, name: "Demo", role: "viewer" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(SNAPSHOT ? SNAPSHOT_USER : null);
  const [ready, setReady] = useState(Boolean(SNAPSHOT));

  useEffect(() => {
    if (SNAPSHOT) return;
    api.auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => setUser((await api.auth.login(email, password)).user), []);
  const signUp = useCallback(async (b: Parameters<Auth["signUp"]>[0]) => setUser((await api.auth.register(b)).user), []);
  const demo = useCallback(async () => setUser((await api.auth.demo()).user), []);
  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signUp, demo, signOut }), [user, ready, signIn, signUp, demo, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth outside AuthProvider");
  return auth;
}

/** The app's pages: signed-out visitors go to the sign-in page, then come back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const { pathname, search } = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return children;
}

/** Where to go after signing in: only a path on this site, never another origin. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/boxes";
}

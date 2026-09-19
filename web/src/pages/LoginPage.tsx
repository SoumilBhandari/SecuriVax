import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Logo, ThemeToggle } from "../components/Brand";
import { safeNext, useAuth } from "../lib/auth";

type Mode = "signin" | "signup";

/** Sign in, create an account, or look around as the demo viewer. */
export default function LoginPage() {
  const { user, ready, signIn, signUp, demo } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);

  // Already signed in (another tab, or back button): straight on.
  useEffect(() => {
    if (ready && user) navigate(next, { replace: true });
  }, [ready, user, next, navigate]);

  const run = async (kind: "form" | "demo", action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      setError(message.charAt(0).toUpperCase() + message.slice(1));
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run("form", () => (mode === "signin" ? signIn(email, password) : signUp({ email, password, name, operator_code: code })));
  };

  const signup = mode === "signup";
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link to="/" aria-label="SecuriVax home" className="flex">
          <Logo height={28} />
        </Link>
        <ThemeToggle />
      </nav>

      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="modal-in w-full max-w-sm">
          <div className="mb-10 text-center">
            <p className="mono-label m-0">{signup ? "New account" : "Sign in"}</p>
            <h1 className="m-0 mt-4 font-display text-[30px] font-semibold tracking-[-0.02em]">{signup ? "Create your account" : "Welcome back"}</h1>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            {signup && (
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="select-pill w-full" placeholder="Amina Otieno" />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="select-pill w-full"
                placeholder="you@clinic.org"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                minLength={signup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
                className="select-pill w-full"
                placeholder={signup ? "At least 8 characters" : "••••••••"}
              />
            </Field>
            {signup && (
              <Field label="Operator code (staff)">
                <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="select-pill w-full" placeholder="Leave empty to view only" />
              </Field>
            )}
            {error && (
              <p role="alert" className="m-0 text-sm font-medium" style={{ color: "var(--signal-discard)" }}>
                {error}
              </p>
            )}
            <button type="submit" disabled={busy != null} className="btn-primary mt-1">
              {busy === "form" ? "One moment…" : signup ? "Create account" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(signup ? "signin" : "signup");
                setError(null);
              }}
              className="mono-label !min-h-0 cursor-pointer bg-transparent hover:text-text"
            >
              {signup ? "Sign in instead →" : "Create an account →"}
            </button>
          </div>

          <div className="my-8 flex items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="mono-label">or</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <button type="button" disabled={busy != null} onClick={() => void run("demo", demo)} className="btn-secondary w-full">
            {busy === "demo" ? "Opening…" : "Try the demo"}
          </button>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

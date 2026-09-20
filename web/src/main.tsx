import "./index.css";

import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, Link, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation, useMatches, useParams } from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, Spinner } from "./components/Layout";
import BoxPage from "./pages/BoxPage";
import HomePage from "./pages/HomePage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import { AuthProvider, useAuth } from "./lib/auth";
import NodePage from "./pages/NodePage";
import { freezeClock, SNAPSHOT } from "./lib/snapshot";
import { applyTheme, followSystemTheme } from "./lib/theme";

// Pages off the tap-a-sticker path load on demand (they pull in the map).
const ClimatePage = lazy(() => import("./pages/ClimatePage"));
const ImpactPage = lazy(() => import("./pages/ImpactPage"));
const TagsPage = lazy(() => import("./pages/TagsPage"));
const LivePage = lazy(() => import("./pages/LivePage"));
const StagePage = lazy(() => import("./pages/StagePage"));

/** "/boxes/BOX-…" is the URL people guess; the route is "/box/:id". */
function BoxRedirect() {
  const { id } = useParams();
  return <Navigate to={`/box/${id}`} replace />;
}

function NotFound() {
  return (
    <Layout back>
      <p className="py-16 text-center text-neutral-400">
        Nothing here.{" "}
        <Link to="/boxes" viewTransition className="text-accent-400 underline underline-offset-2">
          See all boxes
        </Link>
      </p>
    </Layout>
  );
}

/**
 * Tapping a sticker is the one thing that must work for anyone: a health
 * worker holding a box has no account, and neither does a judge scanning an
 * NFC tag. So a single box or carrier is public, and everything that browses
 * the fleet - the box list, live, climate, impact, the stickers and the stage
 * - asks to sign in first and comes back afterwards.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const { pathname, search } = useLocation();
  if (!ready) return <Layout><Spinner /></Layout>; // still asking who this is
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return <>{children}</>;
}

// A page that is still arriving keeps the nav and the page frame, so the wait
// reads as this app loading rather than as a black screen with a word on it.
// The landing page draws its own ground and wants none of this.
const page = (el: ReactNode, chrome = true) => (
  <ErrorBoundary page>
    <Suspense fallback={chrome ? <Layout><Spinner /></Layout> : <Spinner />}>{el}</Suspense>
  </ErrorBoundary>
);

/** The same, behind a sign-in. */
const gated = (el: ReactNode) => page(<RequireAuth>{el}</RequireAuth>);

/**
 * The tab's name follows the route, so a demo with the stage screen, a box
 * and the boxes list open can tell them apart. A box or carrier says which.
 */
function Title() {
  const matches = useMatches();
  const params = useParams();
  useEffect(() => {
    const handle = [...matches].reverse().find((m) => (m.handle as { title?: string } | undefined)?.title)?.handle as { title?: string } | undefined;
    const name = handle?.title?.replace(":id", params.id ?? "");
    document.title = name ? `${name} · SecuriVax` : "SecuriVax";
  }, [matches, params.id]);
  return null;
}

/** Everything inside the router: who's signed in, and the page. */
function Root() {
  return (
    <AuthProvider>
      <Title />
      <Outlet />
      <ScrollRestoration />
    </AuthProvider>
  );
}

// A data router, so navigations can run as view transitions. A snapshot is
// one file: its routes live in the hash.
const router = (SNAPSHOT ? createHashRouter : createBrowserRouter)([
  {
    element: <Root />,
    children: [
      { path: "/", element: page(<LandingPage />, false) },
      { path: "/login", element: page(<LoginPage />), handle: { title: "Sign in" } },
      // Public: what a sticker opens. No account, on any phone.
      { path: "/box/:id", element: page(<BoxPage />), handle: { title: ":id" } },
      { path: "/node/:id", element: page(<NodePage />), handle: { title: ":id" } },
      // Behind a sign-in: everything that browses the fleet rather than one box.
      { path: "/boxes", element: gated(<HomePage />), handle: { title: "Boxes" } },
      { path: "/tags", element: gated(<TagsPage />), handle: { title: "Stickers and codes" } },
      { path: "/live", element: gated(<LivePage />), handle: { title: "Live" } },
      { path: "/stage", element: gated(<StagePage />), handle: { title: "Stage" } },
      { path: "/climate", element: gated(<ClimatePage />), handle: { title: "Climate" } },
      { path: "/impact", element: gated(<ImpactPage />), handle: { title: "Impact" } },
      // "/boxes/BOX-…" is the URL people guess; the route is "/box/:id".
      { path: "/boxes/:id", element: <BoxRedirect /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

freezeClock();
applyTheme();
followSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

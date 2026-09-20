import "./index.css";

import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, Link, Navigate, Outlet, RouterProvider, ScrollRestoration, useMatches, useParams } from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, Spinner } from "./components/Layout";
import BoxPage from "./pages/BoxPage";
import HomePage from "./pages/HomePage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import { AuthProvider } from "./lib/auth";
import NodePage from "./pages/NodePage";
import { freezeClock, SNAPSHOT } from "./lib/snapshot";
import { applyTheme, followSystemTheme } from "./lib/theme";

// Pages off the tap-a-sticker path load on demand (they pull in the map).
const ClimatePage = lazy(() => import("./pages/ClimatePage"));
const PlanPage = lazy(() => import("./pages/PlanPage"));
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

// A page that is still arriving keeps the nav and the page frame, so the wait
// reads as this app loading rather than as a black screen with a word on it.
// The landing page draws its own ground and wants none of this.
const page = (el: ReactNode, chrome = true) => (
  <ErrorBoundary page>
    <Suspense fallback={chrome ? <Layout><Spinner /></Layout> : <Spinner />}>{el}</Suspense>
  </ErrorBoundary>
);

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
      // Open to look at; changes ask for an operator sign-in when they happen.
      { path: "/boxes", element: page(<HomePage />), handle: { title: "Boxes" } },
      { path: "/box/:id", element: page(<BoxPage />), handle: { title: ":id" } },
      { path: "/node/:id", element: page(<NodePage />), handle: { title: ":id" } },
      { path: "/tags", element: page(<TagsPage />), handle: { title: "Stickers and codes" } },
      { path: "/live", element: page(<LivePage />), handle: { title: "Live" } },
      { path: "/stage", element: page(<StagePage />), handle: { title: "Stage" } },
      { path: "/climate", element: page(<ClimatePage />), handle: { title: "Climate" } },
      { path: "/plan", element: page(<PlanPage />), handle: { title: "Trip planner" } },
      { path: "/impact", element: page(<ImpactPage />), handle: { title: "Impact" } },
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

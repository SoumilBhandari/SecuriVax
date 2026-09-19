import "./index.css";

import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createHashRouter, Link, Outlet, RouterProvider, ScrollRestoration } from "react-router";

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

const page = (el: ReactNode) => (
  <ErrorBoundary page>
    <Suspense fallback={<Spinner />}>{el}</Suspense>
  </ErrorBoundary>
);

/** Everything inside the router: who's signed in, and the page. */
function Root() {
  return (
    <AuthProvider>
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
      { path: "/", element: page(<LandingPage />) },
      { path: "/login", element: page(<LoginPage />) },
      // Open to look at; changes ask for an operator sign-in when they happen.
      { path: "/boxes", element: page(<HomePage />) },
      { path: "/box/:id", element: page(<BoxPage />) },
      { path: "/node/:id", element: page(<NodePage />) },
      { path: "/tags", element: page(<TagsPage />) },
      { path: "/live", element: page(<LivePage />) },
      { path: "/stage", element: page(<StagePage />) },
      { path: "/climate", element: page(<ClimatePage />) },
      { path: "/plan", element: page(<PlanPage />) },
      { path: "/impact", element: page(<ImpactPage />) },
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

import "./index.css";

import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Link, Route, Routes } from "react-router";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, Spinner } from "./components/Layout";
import BoxPage from "./pages/BoxPage";
import HomePage from "./pages/HomePage";
import NodePage from "./pages/NodePage";
import { freezeClock, SNAPSHOT } from "./lib/snapshot";

// Pages off the tap-a-sticker path load on demand (they pull in the map).
const ClimatePage = lazy(() => import("./pages/ClimatePage"));
const PlanPage = lazy(() => import("./pages/PlanPage"));
const ImpactPage = lazy(() => import("./pages/ImpactPage"));
const TagsPage = lazy(() => import("./pages/TagsPage"));

function NotFound() {
  return (
    <Layout back>
      <p className="py-16 text-center text-neutral-400">
        Nothing here. <Link to="/" className="text-accent-400 underline underline-offset-2">Go home</Link>
      </p>
    </Layout>
  );
}

const page = (el: ReactNode) => (
  <ErrorBoundary page>
    <Suspense fallback={<Spinner />}>{el}</Suspense>
  </ErrorBoundary>
);

// A snapshot is one file: its routes live in the hash.
const Router = SNAPSHOT ? HashRouter : BrowserRouter;
freezeClock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={page(<HomePage />)} />
        <Route path="/box/:id" element={page(<BoxPage />)} />
        <Route path="/node/:id" element={page(<NodePage />)} />
        <Route path="/tags" element={page(<TagsPage />)} />
        <Route path="/climate" element={page(<ClimatePage />)} />
        <Route path="/plan" element={page(<PlanPage />)} />
        <Route path="/impact" element={page(<ImpactPage />)} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  </StrictMode>,
);

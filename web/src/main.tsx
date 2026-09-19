import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";

import { Layout } from "./components/Layout";
import BoxPage from "./pages/BoxPage";
import ClimatePage from "./pages/ClimatePage";
import HomePage from "./pages/HomePage";
import NodePage from "./pages/NodePage";
import PlanPage from "./pages/PlanPage";
import TagsPage from "./pages/TagsPage";

function NotFound() {
  return (
    <Layout back>
      <p className="py-16 text-center text-slate-600">
        Nothing here. <Link to="/" className="underline">Go home</Link>
      </p>
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/box/:id" element={<BoxPage />} />
        <Route path="/node/:id" element={<NodePage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/climate" element={<ClimatePage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

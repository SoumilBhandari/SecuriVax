import { useEffect, useState } from "react";

import { Card, Layout } from "../components/Layout";
import { StageReset } from "../components/StageReset";
import { api } from "../lib/api";
import type { BoxSummary, NodeSummary } from "../types";

/** The URL to write onto each NFC sticker. */
export default function TagsPage() {
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const origin = window.location.origin;

  useEffect(() => {
    api.boxes().then(setBoxes).catch(() => {});
    api.nodes().then(setNodes).catch(() => {});
  }, []);

  return (
    <Layout back>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">NFC tags</h1>
      <p className="mb-4 text-sm leading-relaxed text-slate-600">
        Write each URL to an NTAG213/215 sticker as a URL record (NFC Tools works on iPhone and Android). Tapping
        a sticker opens that page in the phone's browser. Tap a carrier, then a box, to load the box into it.
        Print the same URL as a QR code on the sticker for phones without NFC.
      </p>
      <Card title="Stage demo" aside="DEMO-01 · BOX-9001/9002">
        <p className="mb-3 text-sm text-slate-600">
          Between rehearsals: clear the stage carrier's readings and put both stage boxes back to fresh. The eight
          lanes are not touched.
        </p>
        <StageReset />
      </Card>
      <Card title="VVM test card">
        <p className="mb-2 text-sm text-slate-600">
          Print this and stick one VVM on the demo bottle to try the camera check.
        </p>
        <a href="/vvm-card.svg" target="_blank" rel="noreferrer">
          <img src="/vvm-card.svg" alt="Four VVM stages, from fresh to beyond the discard point" className="w-full rounded-lg border border-slate-200" />
        </a>
      </Card>
      <Card title="Carriers and storage boxes">
        <TagList items={nodes.map((n) => ({ id: n.id, label: n.label, url: `${origin}/node/${n.id}?tap=1` }))} />
      </Card>
      <Card title="Boxes">
        <TagList items={boxes.map((b) => ({ id: b.id, label: b.product_name, url: `${origin}/box/${b.id}?tap=1` }))} />
      </Card>
    </Layout>
  );
}

function TagList({ items }: { items: { id: string; label: string; url: string }[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (url: string) =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(url);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {item.id} <span className="font-normal text-slate-500">{item.label}</span>
            </p>
            <p className="truncate font-mono text-xs text-slate-500">{item.url}</p>
          </div>
          <button
            onClick={() => copy(item.url)}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
          >
            {copied === item.url ? "Copied" : "Copy"}
          </button>
        </li>
      ))}
    </ul>
  );
}

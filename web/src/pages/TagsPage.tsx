import { useEffect, useState } from "react";

import { BackHeader, Layout, SectionTitle } from "../components/Layout";
import { StageReset } from "../components/StageReset";
import { api } from "../lib/api";
import { asset } from "../lib/snapshot";
import type { BoxSummary, NodeSummary } from "../types";

/** The URL to write onto each NFC sticker, the VVM test card, and the stage demo. */
export default function TagsPage() {
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const origin = window.location.origin;

  useEffect(() => {
    api.boxes().then(setBoxes).catch(() => {});
    api.nodes().then(setNodes).catch(() => {});
  }, []);

  return (
    <Layout>
      <BackHeader eyebrow="Setup" />
      <h1 className="m-0 mb-2 text-[30px] leading-[1.08]">NFC tags</h1>
      <p className="m-0 text-[15px] leading-[1.5] text-neutral-300">
        Write each URL to an NTAG213/215 sticker as a URL record (NFC Tools works on iPhone and Android). Tapping a sticker
        opens that page in the phone's browser. Tap a carrier, then a box, to load the box into it. Print the same URL as a
        QR code for phones without NFC.
      </p>

      <SectionTitle aside="DEMO-01 · BOX-9001/9002">Stage demo</SectionTitle>
      <section className="panel p-5">
        <p className="m-0 mb-3 text-sm leading-[1.45] text-neutral-300">
          Between rehearsals: clear the stage carrier's readings and put both stage boxes back to fresh. The eight lanes are
          not touched.
        </p>
        <StageReset />
      </section>

      <SectionTitle>VVM test card</SectionTitle>
      <section className="panel p-5">
        <p className="m-0 mb-3 text-sm leading-[1.45] text-neutral-300">
          Print this and stick one VVM on the demo bottle to try the camera check. Or open the{" "}
          <a href={asset("/vvm-target.html")} target="_blank" rel="noreferrer" className="text-accent-400 underline underline-offset-2">
            single-VVM test target
          </a>{" "}
          on a laptop and point the phone at it: pick a stage, or slide through every shade.
        </p>
        <a href={asset("/vvm-card.svg")} target="_blank" rel="noreferrer">
          <img src={asset("/vvm-card.svg")} alt="Four VVM stages, from fresh to beyond the discard point" className="w-full rounded-lg" />
        </a>
      </section>

      <SectionTitle>Carriers and storage</SectionTitle>
      <TagList items={nodes.map((n) => ({ id: n.id, label: n.label, url: `${origin}/node/${n.id}?tap=1` }))} />
      <SectionTitle>Boxes</SectionTitle>
      <TagList items={boxes.map((b) => ({ id: b.id, label: b.product_name, url: `${origin}/box/${b.id}?tap=1` }))} />
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
    <ul className="panel m-0 list-none p-0">
      {items.map((item, i) => (
        <li key={item.id} className={`flex items-center gap-3 px-5 py-2.5 ${i ? "border-t border-line" : ""}`}>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-medium">
              {item.id} <span className="font-normal text-neutral-400">{item.label}</span>
            </p>
            <p className="m-0 truncate font-mono text-xs text-neutral-500">{item.url}</p>
          </div>
          <button onClick={() => copy(item.url)} className="btn-quiet !min-h-9 shrink-0 !px-3 text-xs">
            {copied === item.url ? "Copied" : "Copy"}
          </button>
        </li>
      ))}
    </ul>
  );
}

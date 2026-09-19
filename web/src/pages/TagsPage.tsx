import { useEffect, useState } from "react";
import { Link } from "react-router";

import { StageIcon } from "../components/Icons";
import { BackHeader, Layout, PageTitle, SectionTitle, Split } from "../components/Layout";
import { QrCode } from "../components/QrCode";
import { StageReset } from "../components/StageReset";
import { api } from "../lib/api";
import { useCanTapTags } from "../lib/device";
import { asset } from "../lib/snapshot";
import type { BoxSummary, NodeSummary } from "../types";

/** The URL to write onto each NFC sticker, the VVM test card, and the stage demo. */
export default function TagsPage() {
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const origin = window.location.origin;
  const canTap = useCanTapTags();

  useEffect(() => {
    api.boxes().then(setBoxes).catch(() => {});
    api.nodes().then(setNodes).catch(() => {});
  }, []);

  return (
    <Layout>
      <BackHeader />
      <PageTitle eyebrow="Setup" title="NFC tags" />
      {canTap ? (
        <p className="m-0 -mt-3 text-neutral-300 lg:mb-8 lg:max-w-3xl">
          Write each URL to an NTAG213/215 sticker as a URL record (NFC Tools works on iPhone and Android). Tapping a sticker
          opens that page in the phone's browser. Tap a carrier, then a box, to load the box into it. Print the same URL as a
          QR code for phones without NFC.
        </p>
      ) : (
        <p className="m-0 -mt-3 text-neutral-300 lg:mb-8 lg:max-w-3xl">
          Write each URL to an NTAG213/215 sticker as a URL record, from a phone (NFC Tools works on iPhone and Android). Each
          tag's QR code opens the same page and prints as a fallback sticker.
        </p>
      )}

      <Split
        left={
          <>
            <SectionTitle aside="DEMO-01 · BOX-9001/9002">Stage demo</SectionTitle>
            <section className="panel flex flex-col gap-3 p-4">
              <p className="m-0">
                Put the stage screen on the projector: the carrier's live temperature and both stage boxes, updating with every
                reading.
              </p>
              <Link to="/stage" className="btn-primary">
                <StageIcon size={22} />
                Open the stage screen
              </Link>
              <p className="ui-caption m-0">
                Between rehearsals: clear the stage carrier's readings and put both stage boxes back to fresh. The other lanes are
                not touched.
              </p>
              <StageReset />
            </section>

            <SectionTitle>VVM test card</SectionTitle>
            <section className="panel p-4">
              <p className="m-0 mb-3">
                Print this and stick one VVM on the demo bottle to try the camera check. Or open the{" "}
                <a href={asset("/vvm-target.html")} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  single-VVM test target
                </a>{" "}
                on a laptop and point the phone at it: pick a stage, or slide through every shade.
              </p>
              <a href={asset("/vvm-card.svg")} target="_blank" rel="noreferrer">
                <img src={asset("/vvm-card.svg")} alt="Four VVM stages, from fresh to beyond the discard point" className="w-full rounded-xl border border-line" />
              </a>
            </section>
          </>
        }
        right={
          <>
            <SectionTitle>Carriers and storage</SectionTitle>
            <TagList items={nodes.map((n) => ({ id: n.id, label: n.label, url: `${origin}/node/${n.id}?tap=1` }))} />
            <SectionTitle>Boxes</SectionTitle>
            <TagList items={boxes.map((b) => ({ id: b.id, label: b.product_name, url: `${origin}/box/${b.id}?tap=1` }))} />
          </>
        }
      />
    </Layout>
  );
}

function TagList({ items }: { items: { id: string; label: string; url: string }[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const canTap = useCanTapTags(); // a computer shows each tag's QR code: its way to hand a page to a phone
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
        <li key={item.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold">
              {item.id} <span className="font-normal text-neutral-500">{item.label}</span>
            </p>
            <p className="m-0 truncate font-mono text-xs text-neutral-500">{item.url}</p>
          </div>
          {!canTap && (
            <button
              onClick={() => setShown(shown === item.id ? null : item.id)}
              aria-expanded={shown === item.id}
              className="btn-quiet !min-h-10 shrink-0 !px-3 !text-sm"
            >
              QR
            </button>
          )}
          <button onClick={() => copy(item.url)} className="btn-secondary !min-h-10 shrink-0 !px-3 !text-sm">
            {copied === item.url ? "Copied" : "Copy"}
          </button>
          {shown === item.id && (
            <div className="flex basis-full items-center gap-4 pt-1">
              <QrCode text={item.url} size={136} label={`QR code for ${item.id}`} />
              <p className="ui-caption m-0">Opens {item.id} on a phone, like tapping its sticker.</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

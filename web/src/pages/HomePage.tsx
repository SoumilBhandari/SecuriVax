import { useEffect, useState } from "react";
import { Link } from "react-router";

import { BatteryIcon, TapIcon } from "../components/Icons";
import { Card, ErrorNote, Layout, Spinner } from "../components/Layout";
import { VerdictChip } from "../components/Verdict";
import { api } from "../lib/api";
import { ago, pct, SEVERITY_ORDER, temp, VERDICT_STYLE } from "../lib/format";
import type { BoxSummary, NodeSummary } from "../types";

export default function HomePage() {
  const [boxes, setBoxes] = useState<BoxSummary[] | null>(null);
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      api
        .boxes()
        .then((b) => {
          setBoxes(b);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
      api.nodes().then(setNodes).catch(() => {});
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  const sorted = [...(boxes ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.verdict] - SEVERITY_ORDER[b.verdict] || b.budget_used - a.budget_used,
  );

  return (
    <Layout>
      <div className="mb-5 rounded-2xl bg-slate-900 p-5 text-white">
        <TapIcon className="mb-2 text-sky-300" size={24} />
        <h1 className="text-xl font-semibold leading-snug">Is this box still good?</h1>
        <p className="mt-1 text-sm text-slate-300">
          Tap the sticker on any box of vaccines or rapid tests with your phone to see its verdict.
        </p>
      </div>

      {error && <ErrorNote error={error} />}
      {!boxes && !error && <Spinner />}

      {boxes && (
        <Card title="Boxes" aside="worst first">
          <ul className="divide-y divide-slate-100">
            {sorted.map((b) => (
              <li key={b.id}>
                <Link to={`/box/${b.id}`} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">
                      {b.id}
                      <span className="ml-2 text-sm font-normal text-slate-500">{b.product_name}</span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full ${VERDICT_STYLE[b.verdict].bar}`}
                          style={{ width: `${Math.min(b.budget_used, 1) * 100}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{pct(b.budget_used)}</span>
                    </div>
                    {b.current_node_id && <p className="mt-1 text-xs text-emerald-700">In {b.current_node_id}</p>}
                  </div>
                  <VerdictChip verdict={b.verdict} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nodes.length > 0 && (
        <Card title="Carriers and storage boxes">
          <ul className="divide-y divide-slate-100">
            {nodes.map((n) => (
              <li key={n.id}>
                <Link to={`/node/${n.id}`} className="flex items-center gap-3 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${n.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{n.label}</p>
                    <p className="text-xs text-slate-500">
                      {n.facility} · seen {ago(n.last_seen_at)} · {n.box_ids.length} boxes
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-slate-900">{temp(n.latest?.temp_c)}</p>
                    {n.battery_v != null && (
                      <p className={`flex items-center justify-end gap-1 text-xs ${n.low_battery ? "text-red-600" : "text-slate-500"}`}>
                        <BatteryIcon size={12} /> {n.battery_v.toFixed(2)} V
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-center text-sm text-slate-500">
        <Link to="/tags" className="underline underline-offset-2">
          NFC tags and the VVM test card
        </Link>
      </p>
    </Layout>
  );
}

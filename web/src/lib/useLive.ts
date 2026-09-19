import { useEffect, useRef, useState } from "react";

import type { LiveReading, LiveRecent } from "../types";
import { api } from "./api";
import { SNAPSHOT } from "./snapshot";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline" | "snapshot";

const KEEP = 400; // readings held in memory, across every node
const RETRY_MS = 5000; // after the server refuses or the stream closes for good

/**
 * The live signal: the latest readings, then every new one as the server gets
 * it. Server-sent events resume from the last id on their own after a drop;
 * a refused or closed stream is reopened from the newest reading held.
 */
export function useLive() {
  const [readings, setReadings] = useState<LiveReading[]>([]); // oldest first
  const [band, setBand] = useState<LiveRecent["band"] | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [firstNewId, setFirstNewId] = useState<number | null>(null);
  const newest = useRef(0);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const add = (r: LiveReading) => {
      if (r.id <= newest.current) return;
      newest.current = r.id;
      setReadings((prev) => [...prev, r].slice(-KEEP));
    };

    const connect = () => {
      if (!alive) return;
      source = new EventSource(api.liveStreamUrl(newest.current));
      source.addEventListener("hello", () => setStatus("live"));
      source.addEventListener("reading", (ev) => add(JSON.parse((ev as MessageEvent<string>).data)));
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) {
          setStatus("offline");
          retry = setTimeout(connect, RETRY_MS);
        } else setStatus("reconnecting");
      };
    };

    api
      .liveRecent()
      .then((r) => {
        if (!alive) return;
        newest.current = r.last_id;
        setReadings(r.readings);
        setBand(r.band);
        setFirstNewId(r.last_id + 1);
        if (SNAPSHOT) setStatus("snapshot");
        else connect();
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setStatus("offline");
      });

    return () => {
      alive = false;
      clearTimeout(retry);
      source?.close();
    };
  }, []);

  return { readings, band, status, error, firstNewId };
}

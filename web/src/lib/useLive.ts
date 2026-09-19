import { useEffect, useRef, useState } from "react";

import type { LiveReading, LiveRecent } from "../types";
import { api } from "./api";
import { SNAPSHOT } from "./snapshot";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline" | "snapshot";

const KEEP = 400; // readings held in memory, across every node
const RETRY_MS = 5000; // after the server refuses or the stream closes for good
// The server pings every 10 s. Silence for longer means the connection is dead
// even if the browser thinks it's open (a proxy can hold one open after the
// server restarts, and phones switch networks), so start a new one.
const SILENCE_MS = 25000;

/**
 * Follow the live stream until stopped. Server-sent events resume from the last
 * id on their own after a drop; a refused, closed or silent stream is reopened
 * from `url()`, asked again each time. Returns the stop function.
 */
function follow(url: () => string, onReading: (r: LiveReading) => void, onStatus: (s: LiveStatus) => void = () => {}) {
  let stopped = false;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heard = Date.now();
  const hear = () => {
    heard = Date.now();
  };

  const connect = () => {
    if (stopped) return;
    hear();
    source = new EventSource(url());
    source.addEventListener("hello", () => {
      hear();
      onStatus("live");
    });
    source.addEventListener("ping", hear);
    source.addEventListener("reading", (ev) => {
      hear();
      onReading(JSON.parse((ev as MessageEvent<string>).data));
    });
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) {
        onStatus("offline");
        retry = setTimeout(connect, RETRY_MS);
      } else onStatus("reconnecting");
    };
  };

  const watchdog = setInterval(() => {
    if (!source || source.readyState === EventSource.CLOSED || Date.now() - heard < SILENCE_MS) return;
    source.close();
    onStatus("reconnecting");
    connect();
  }, 5000);

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(watchdog);
    source?.close();
  };
}

/** The live signal: the latest readings, then every new one as the server gets it. */
export function useLive() {
  const [readings, setReadings] = useState<LiveReading[]>([]); // oldest first
  const [band, setBand] = useState<LiveRecent["band"] | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [firstNewId, setFirstNewId] = useState<number | null>(null);
  const newest = useRef(0);

  useEffect(() => {
    let alive = true;
    let stop = () => {};

    const add = (r: LiveReading) => {
      if (r.id <= newest.current) return;
      newest.current = r.id;
      setReadings((prev) => [...prev, r].slice(-KEEP));
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
        else stop = follow(() => api.liveStreamUrl({ after: newest.current }), add, setStatus);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setStatus("offline");
      });

    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { readings, band, status, error, firstNewId };
}

/**
 * Call `onReading` soon after `nodeId` sends a reading: at once, then at most
 * every `minGapMs` (a burst of readings becomes one call at its end), so a page
 * can re-fetch what the reading changed within about a second.
 */
export function useReadingNudge(nodeId: string | null | undefined, onReading: () => void, minGapMs = 1500) {
  const callback = useRef(onReading);
  callback.current = onReading;

  useEffect(() => {
    if (!nodeId || SNAPSHOT) return;
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const nudge = () => {
      if (pending) return;
      const wait = last + minGapMs - Date.now();
      pending = setTimeout(() => {
        pending = undefined;
        last = Date.now();
        callback.current();
      }, Math.max(wait, 0));
    };
    const stop = follow(() => api.liveStreamUrl({ node: nodeId }), nudge);
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, [nodeId, minGapMs]);
}

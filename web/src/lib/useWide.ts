import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

/** Laptop width or wider, live. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

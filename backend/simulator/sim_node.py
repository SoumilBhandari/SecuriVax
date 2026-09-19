"""Pretend to be an ESP32 node: sample, buffer, upload, retry.

    python -m simulator.sim_node --node DEMO-01 --api http://localhost:8000

While it runs, type a letter and press Enter to change what the "sensor" sees:
    h  heat (carrier left in the sun)     f  freeze (against frozen ice packs)
    n  normal cold chain                  o  toggle offline (no signal)
    q  quit

It speaks the same protocol as the firmware, so it exercises the real ingest
path: readings are kept until the server acks them, and resent after an outage.
"""

import argparse
import random
import sys
import threading
import time

import httpx

from simulator.common import KISUMU_TO_KOMBEWA, along, cold_box_temp

TARGETS = {"n": None, "h": 38.0, "f": -4.0}
NAMES = {"n": "normal", "h": "heat", "f": "freeze"}


class SimNode:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.boot_id = int(time.time())
        self.boot_at = time.monotonic()
        self.seq = 0
        self.buffer: list[dict] = []
        self.mode = args.scenario
        self.offline = False
        self.temp = cold_box_temp(time.time())
        self.battery = 4.15
        self.running = True

    def uptime_ms(self) -> int:
        return int((time.monotonic() - self.boot_at) * 1000)

    def sample(self) -> dict:
        now = time.time()
        target = TARGETS[self.mode]
        goal = cold_box_temp(now) if target is None else target
        # First-order lag: a real cold box warms and cools gradually.
        self.temp += (goal - self.temp) * 0.35 + random.gauss(0, 0.1)
        rh = 55 + (20 if self.mode == "h" else 0) + random.gauss(0, 1.5)
        elapsed = time.monotonic() - self.boot_at
        lat, lon = along(KISUMU_TO_KOMBEWA, elapsed / self.args.trip_seconds)
        self.battery = max(3.3, self.battery - 0.0004)
        self.seq += 1
        return {
            "seq": self.seq, "ts": int(now), "uptime_ms": self.uptime_ms(),
            "temp_c": round(self.temp, 2), "rh": round(min(max(rh, 0), 100), 1),
            "lat": round(lat, 6), "lon": round(lon, 6), "battery_v": round(self.battery, 3),
        }

    def upload(self, client: httpx.Client) -> str:
        if self.offline:
            return "offline, buffering"
        if not self.buffer:
            return "nothing to send"
        batch = self.buffer[: self.args.batch]
        try:
            res = client.post(
                f"{self.args.api}/api/ingest/readings",
                headers={"X-Node-Key": self.args.key},
                json={
                    "node_id": self.args.node, "boot_id": self.boot_id,
                    "uptime_ms": self.uptime_ms(), "fw_version": "sim-1",
                    "battery_v": self.battery, "readings": batch,
                },
            )
            res.raise_for_status()
        except httpx.HTTPError as exc:
            return f"upload failed ({exc.__class__.__name__}), will retry"
        ack = res.json()["ack_seq"]
        if ack is not None:
            self.buffer = [r for r in self.buffer if r["seq"] > ack]
        body = res.json()
        return f"sent {len(batch)}: {body['accepted']} new, {body['duplicates']} dup, {len(body['rejected'])} rejected"

    def keyboard(self) -> None:
        for line in sys.stdin:
            key = line.strip().lower()[:1]
            if key in TARGETS:
                self.mode = key
                print(f"  -> sensor now sees: {NAMES[key]}")
            elif key == "o":
                self.offline = not self.offline
                print(f"  -> {'OFFLINE (buffering)' if self.offline else 'back online'}")
            elif key == "q":
                self.running = False
                return

    def run(self) -> None:
        threading.Thread(target=self.keyboard, daemon=True).start()
        print(f"{self.args.node} boot {self.boot_id} -> {self.args.api}  (h/f/n/o/q + Enter)")
        with httpx.Client(timeout=10) as client:
            while self.running:
                reading = self.sample()
                self.buffer.append(reading)
                status = self.upload(client)
                print(
                    f"#{reading['seq']:>4} {reading['temp_c']:6.2f} C {reading['rh']:5.1f}% "
                    f"[{NAMES[self.mode]}] buffered={len(self.buffer):>3}  {status}"
                )
                time.sleep(self.args.interval)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--node", default="DEMO-01")
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--key", default="dev-node-key")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between readings")
    parser.add_argument("--batch", type=int, default=200, help="max readings per upload")
    parser.add_argument("--trip-seconds", type=float, default=600, help="real seconds to drive the route")
    parser.add_argument("--scenario", choices=list(TARGETS), default="n", help="starting mode")
    SimNode(parser.parse_args()).run()


if __name__ == "__main__":
    main()

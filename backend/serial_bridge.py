"""
USB serial → /ingest bridge.

Use this when the ESP32 has Wi‑Fi but cannot reach the Mac (common on
phone hotspots). The sketch already prints one JSON object per line;
this script reads those lines and POSTs them to the local API.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    print("Install pyserial:  pip install pyserial", file=sys.stderr)
    raise SystemExit(1)


def find_port() -> str | None:
    for p in list_ports.comports():
        desc = f"{p.device} {p.description} {p.hwid}".lower()
        if any(k in desc for k in ("usb", "uart", "wch", "cp210", "ch340", "slab", "serial")):
            if "bluetooth" in desc:
                continue
            return p.device
    return None


def post(url: str, frame: dict) -> None:
    data = json.dumps(frame).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        resp.read()


def main() -> int:
    parser = argparse.ArgumentParser(description="Bridge ESP32 Serial JSON → /ingest")
    parser.add_argument("--port", default=None, help="e.g. /dev/cu.usbserial-0001")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--url", default="http://127.0.0.1:8000/ingest")
    args = parser.parse_args()

    port = args.port or find_port()
    if not port:
        print("No serial port found. Close Arduino Serial Monitor, plug in ESP32,", file=sys.stderr)
        print("then re-run. Or pass --port /dev/cu.XXXX", file=sys.stderr)
        print("\nAvailable ports:", file=sys.stderr)
        for p in list_ports.comports():
            print(f"  {p.device}  ({p.description})", file=sys.stderr)
        return 1

    print(f"reading {port} @ {args.baud}")
    print(f"posting → {args.url}")
    print("press ESP32 RESET if you see nothing\n")

    ser = serial.Serial(port, args.baud, timeout=1)
    time.sleep(0.5)
    ser.reset_input_buffer()

    n = 0
    while True:
        try:
            raw = ser.readline().decode("utf-8", errors="ignore").strip()
        except serial.SerialException as exc:
            print(f"serial error: {exc}", file=sys.stderr)
            return 1
        if not raw:
            continue
        # Pass through non-JSON debug lines
        if not raw.startswith("{"):
            print(f"[esp] {raw}")
            continue
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            print(f"[esp] {raw}")
            continue
        try:
            post(args.url, frame)
            n += 1
            nfc = frame.get("nfc_id") or "-"
            ta = frame.get("temp_c_a")
            tb = frame.get("temp_c_b")
            extras = []
            if ta is not None:
                extras.append(f"DHT27={ta}C")
            if tb is not None:
                extras.append(f"DHT26={tb}C")
            dual = (" " + " ".join(extras)) if extras else ""
            print(
                f"[{n}] avg={frame.get('temp_c')}C{dual} "
                f"hum={frame.get('humidity')}% "
                f"mkt={frame.get('mkt_c')} "
                f"nfc={nfc} → cloud ok"
            )
        except urllib.error.URLError as exc:
            print(f"POST failed (is uvicorn running?): {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())

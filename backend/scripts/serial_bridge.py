"""Forward a USB-connected node's readings to the API, for a node without WiFi.

The firmware prints every sample to serial ("#12 23.40 C 52.0% no fix"); this
reads those lines and uploads them exactly as the node would, with the node's
own boot id and sequence numbers. So if the node later uploads the same
readings over WiFi, the server sees duplicates and keeps one copy.

    cd backend
    .venv/bin/python -m scripts.serial_bridge --port /dev/cu.usbserial-0001

Needs pyserial (in requirements-dev.txt). Readings wait in memory while the API
is unreachable and go up once it's back, like the node's own queue; an
unplugged board is waited for, not a crash. For the live site:

    NODE_KEY=<the key set on Render> .venv/bin/python -m scripts.serial_bridge --api https://securivax.onrender.com
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SAMPLE = re.compile(r"^#(\d+) (-?\d+(?:\.\d+)?) C (nan|-?\d+(?:\.\d+)?)%")
BOOT = re.compile(r"\bboot (\d+)\b")
# The boot line naming the temperature sensor, e.g. "temperature and humidity: DHT11 on GPIO 4".
SENSOR = re.compile(r"^temperature(?: and humidity)?: (DS18B20|SHT31|DHT11|DHT22)\b")
MAX_PENDING = 5000


def parse_sample(line: str) -> dict | None:
    m = SAMPLE.match(line)
    if not m:
        return None
    rh = None if m.group(3) == "nan" else float(m.group(3))
    return {"seq": int(m.group(1)), "ts": int(time.time()), "temp_c": float(m.group(2)), "rh": rh}


def parse_sensor(line: str) -> str | None:
    m = SENSOR.match(line)
    return m.group(1).lower() if m else None


def upload(api: str, node: str, key: str, boot: int, readings: list[dict], sensor: str | None = None) -> int | None:
    """Send a batch; returns the acked seq, or None if it didn't go through."""
    batch = {"node_id": node, "boot_id": boot, "fw_version": "usb-bridge", "readings": readings}
    if sensor:
        batch["sensor"] = sensor  # so the server allows for this sensor's error
    body = json.dumps(batch).encode()
    req = urllib.request.Request(
        f"{api.rstrip('/')}/api/ingest/readings", data=body, method="POST",
        headers={"Content-Type": "application/json", "X-Node-Key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            ack = json.load(res)
    except urllib.error.HTTPError as e:
        print(f"  upload refused: HTTP {e.code} {e.read()[:200]!r}", file=sys.stderr)
        if e.code in (400, 401, 422):
            sys.exit("check --node and the node key (NODE_KEY)")
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"  API unreachable ({e}); keeping {len(readings)} to retry", file=sys.stderr)
        return None
    print(f"  uploaded {len(readings)}: {ack['accepted']} new, {ack['duplicates']} dup, {len(ack['rejected'])} rejected"
          + (f", worst verdict {ack['worst_verdict']}" if ack.get("worst_verdict") else ""))
    return ack["ack_seq"]


def main() -> None:
    import serial  # imported here so --help works without pyserial

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", default="/dev/cu.usbserial-0001")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--node", default="DEMO-01")
    parser.add_argument("--no-reset", action="store_true",
                        help="don't restart the board (the boot id then comes from the next boot line, or --boot)")
    parser.add_argument("--boot", type=int, help="the node's boot id, if it booted before the bridge started")
    args = parser.parse_args()
    key = os.environ.get("NODE_KEY", "dev-node-key")

    def connect(reset: bool):
        """Open the board's port, waiting for it if it's unplugged."""
        waiting = False
        while True:
            try:
                port = serial.Serial(args.port, args.baud, timeout=1)
                break
            except (serial.SerialException, OSError):
                if not waiting:
                    print(f"waiting for the board on {args.port} (plug it in)", file=sys.stderr)
                    waiting = True
                time.sleep(2)
        if reset:  # restart so the boot line (and its boot id) comes through
            port.dtr = False
            port.rts = True
            time.sleep(0.2)
            port.rts = False
        port.reset_input_buffer()
        return port

    port = connect(not args.no_reset)
    print(f"bridging {args.port} -> {args.api} as {args.node}")

    boot = args.boot
    sensor = None
    pending: list[dict] = []
    while True:
        try:
            raw = port.readline()
        except (serial.SerialException, OSError):
            # A loose cable mid-demo: wait for the board instead of dying. It
            # reboots when it's plugged back in, and its boot line follows.
            port.close()
            print("board unplugged", file=sys.stderr)
            port = connect(reset=False)
            print("board back: reading again")
            continue
        if not raw:
            continue
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        print(line)
        sensor = parse_sensor(line) or sensor
        if (m := BOOT.search(line)) and ("SecuriVax" in line or "Vialtality" in line):  # or older firmware
            if boot is not None and int(m.group(1)) != boot:
                pending.clear()  # the board restarted: its sequence starts over
            boot = int(m.group(1))
            continue
        sample = parse_sample(line)
        if sample is None:
            continue
        if boot is None:
            print("  waiting for the boot line (or pass --boot) before uploading", file=sys.stderr)
            continue
        pending = (pending + [sample])[-MAX_PENDING:]
        acked = upload(args.api, args.node, key, boot, pending, sensor)
        if acked is not None:
            pending = [r for r in pending if r["seq"] > acked]


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass

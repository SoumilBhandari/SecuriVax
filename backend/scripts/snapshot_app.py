"""The whole web app as one HTML file, with its data saved from this database.

    cd backend && .venv/bin/python -m scripts.snapshot_app --out ../vialtality-app.html

Every GET the app makes is answered from data saved now; the POSTs that only
read (the AI report, the dispatch agent, trip plans for the default questions)
are saved too. Anything that would change data (loading boxes, reading a VVM
photo, confirming it) says it needs the live app. Runs the API in-process on
the dev database; nothing is written except the AI report cache.
"""

import argparse
import json
import re
import subprocess
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.security import ALL_LIMITS

WEB = Path(__file__).resolve().parents[2] / "web"


def capture() -> dict:
    client = TestClient(app)
    get, post = {}, {}

    def fetch(path: str) -> object:
        for limit in ALL_LIMITS:
            limit.reset()
        res = client.get(path)
        res.raise_for_status()
        get[path] = res.json()
        return get[path]

    def ask(path: str, body: dict | None = None) -> None:
        for limit in ALL_LIMITS:
            limit.reset()
        raw = json.dumps(body, separators=(",", ":")) if body is not None else ""
        res = client.post(path, content=raw or None, headers={"Content-Type": "application/json"} if raw else {})
        if res.status_code == 200:
            post[f"{path} {raw}" if raw else path] = res.json()

    boxes = fetch("/api/boxes")
    for path in ("/api/boxes/fleet/summary", "/api/boxes/learning/summary", "/api/products", "/api/facilities",
                 "/api/climate/stores", "/api/climate/carriers", "/api/impact"):
        fetch(path)
    nodes = fetch("/api/nodes")
    for b in boxes:
        fetch(f"/api/boxes/{b['id']}/report")
        fetch(f"/api/boxes/{b['id']}/counterfactual")
        ask(f"/api/boxes/{b['id']}/explain")
    for n in nodes:
        fetch(f"/api/nodes/{n['id']}")
        if fetch(f"/api/nodes/{n['id']}/forecast").get("available"):
            ask(f"/api/nodes/{n['id']}/agent", {"destination_id": None})
    # The planner's first question, and the obvious next ones.
    stores = [f for f in get["/api/facilities"] if f["kind"] == "store"]
    origin = stores[0]["id"] if stores else ""
    carriers = [n["id"] for n in nodes if n["kind"] in ("carrier", "cold_box") and not n.get("backup_for")]
    for p in get["/api/products"]:
        ask("/api/climate/plan", {"product_id": p["id"], "origin_id": origin, "carrier_id": None, "session_h": 6})
    for c in carriers:
        ask("/api/climate/plan", {"product_id": "opv", "origin_id": origin, "carrier_id": c, "session_h": 6})
    return {"taken_at": int(time.time()), "get": get, "post": post}


def build() -> Path:
    subprocess.run(["npx", "vite", "build", "--config", "vite.snapshot.config.mjs"], cwd=WEB, check=True,
                   env={**__import__("os").environ, "VITE_SNAPSHOT": "1"}, stdout=subprocess.DEVNULL)
    return WEB / "dist-snapshot"


def assemble(dist: Path, data: dict) -> str:
    html = (dist / "index.html").read_text()
    css = "".join((dist / m).read_text() for m in re.findall(r'<link rel="stylesheet"[^>]*href="\./([^"]+)"', html))
    js = "".join((dist / m).read_text() for m in re.findall(r'<script type="module"[^>]*src="\./([^"]+)"', html))
    fonts = re.search(r'<link\s+rel="stylesheet"\s+href="(https://fonts\.googleapis\.com[^"]+)"', html).group(1)
    payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    script = js.replace("</script", "<\\/script")
    return "\n".join([
        '<meta charset="utf-8">',  # the file is also opened on its own, not only inside a host page
        "<title>Vialtality app</title>",
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        f'<link rel="stylesheet" href="{fonts}">',
        f"<style>{css}</style>",
        '<div id="root"></div>',
        f'<script type="application/json" id="vt-snapshot">{payload}</script>',
        f'<script type="module">{script}</script>',
    ])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=WEB / "dist-snapshot" / "vialtality-app.html")
    args = ap.parse_args()
    data = capture()
    page = assemble(build(), data)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(page)
    print(f"{args.out}: {len(page) / 1e6:.1f} MB, {len(data['get'])} GETs and {len(data['post'])} POSTs saved")


if __name__ == "__main__":
    main()

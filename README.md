# ColdTrace

Last-mile cold chain monitor for vaccines and rapid diagnostic tests.

> Today's cold chain goes blind on the last mile and doesn't monitor rapid tests at all.
> We cover both and tell the health worker whether this box is still good.

| Folder | What lives there |
| --- | --- |
| `backend/` | FastAPI API, verdict engine, Gemini explainer, node simulator |
| `web/` | Phone web app (React + Vite + Tailwind) |
| `firmware/` | ESP32 node skeleton (PlatformIO) |
| `docs/` | Architecture notes and demo script |

Setup instructions land as each piece is built.

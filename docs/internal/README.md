# Internal notes

Working documents, kept because they record why things are the way they are.
They are **not** descriptions of the current system and some of them describe
designs that were superseded during the build.

| File | What it was for | Still true? |
| --- | --- | --- |
| `ui-overhaul.md` | The design contract for the September UI overhaul: type, colour, motion, the chapter structure. | Mostly. The hero no longer carries two live chips, there are four nav tabs rather than five, and the landing nav has two links. |
| `hero-3d-brief.md` | A brief written for a code-generation tool, describing a hero scene built around a puck-shaped node and a modelled carrier. | No. The real hero renders the 102 enclosure CAD (`web/public/hero/models/device.glb`, four parts) and the frame-sequence pipeline it describes was never produced. |

For what the system actually is, read
[../architecture.md](../architecture.md).

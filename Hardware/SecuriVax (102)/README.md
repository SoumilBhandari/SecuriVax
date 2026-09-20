# SecuriVax 102

The designed node: a sealed enclosure sized around a LiPo cell and the board.

```
TopCover     lid, carries the lockup and the status LED
Battery      3.7 V LiPo
Board        ESP32 + sensor headers
LowCover     base
```

Modelled in Onshape, exported as glTF. The export lives in
[`web/public/hero/models/`](../../web/public/hero/models) because the landing
page renders it live — the device that opens up on the front page is this CAD.

Why sealed: the node spends eight hours sitting in a cold box full of melting
ice. Condensation on an open devkit is what kills it first.

Parts: [`../README.md`](../README.md). Pin map and firmware builds:
[docs/architecture.md](../../docs/architecture.md#hardware).

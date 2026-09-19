# Samsung SmartTag → Vialtality location bridge

A SmartTag inside the carrier gives its position without a GPS module on the
node. The server attaches that position to every temperature reading by time,
interpolating between SmartTag fixes, so the route map and chain of custody
still work.

## The catch

Samsung has **no official API** for SmartTag locations. The standard
SmartThings API doesn't return tag coordinates. The practical route is the
community Home Assistant integration
[HA-SmartThings-Find](https://github.com/Vedeneb/HA-SmartThings-Find), which
reads SmartThings Find (it's reverse-engineered, so it may break).

SmartTags are located by nearby Galaxy phones, so fixes arrive every few
minutes in town and rarely out in the countryside. Vialtality joins fixes up to
2 hours apart, and uses a lone fix for readings within 30 minutes of it.

## Setup

1. Install Home Assistant, then HA-SmartThings-Find (through HACS), and sign in
   with the Samsung account that owns the tag. The tag appears as a
   `device_tracker` entity, e.g. `device_tracker.smarttag_demo_01`.
2. Add to `configuration.yaml`:

```yaml
rest_command:
  vialtality_location:
    url: "https://YOUR-VIALTALITY-DOMAIN/api/ingest/locations"
    method: POST
    content_type: "application/json"
    headers:
      X-Node-Key: !secret vialtality_node_key
    payload: >
      {"node_id": "{{ node_id }}", "source": "smarttag",
       "points": [{"ts": {{ ts }}, "lat": {{ lat }}, "lon": {{ lon }},
                   "accuracy_m": {{ acc }}}]}
```

3. Add an automation for each tag (`automations.yaml`):

```yaml
- alias: "SmartTag DEMO-01 to Vialtality"
  trigger:
    - platform: state
      entity_id: device_tracker.smarttag_demo_01
      attribute: latitude
  action:
    - service: rest_command.vialtality_location
      data:
        node_id: DEMO-01
        ts: "{{ as_timestamp(trigger.to_state.last_updated) | int }}"
        lat: "{{ state_attr('device_tracker.smarttag_demo_01', 'latitude') }}"
        lon: "{{ state_attr('device_tracker.smarttag_demo_01', 'longitude') }}"
        acc: "{{ state_attr('device_tracker.smarttag_demo_01', 'gps_accuracy') | default(50) }}"
```

`node_id` is the carrier the tag rides in, and the key is that node's
`NODE_KEY`. If the integration exposes when SmartThings Find last saw the tag,
use that for `ts` instead of `last_updated`.

## Without Home Assistant

Anything that can POST JSON works: a phone shortcut, a script, a CSV import.

```bash
curl -X POST https://YOUR-VIALTALITY-DOMAIN/api/ingest/locations \
  -H "X-Node-Key: $NODE_KEY" -H "Content-Type: application/json" \
  -d '{"node_id":"DEMO-01","source":"smarttag","points":[{"ts":1789790000,"lat":-0.0917,"lon":34.768}]}'
```

Resending is harmless: each fix is keyed on (node, time, source).

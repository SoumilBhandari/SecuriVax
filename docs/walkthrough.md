# Five-minute walkthrough

Read this close to as written. Stage cues are in *[italics]*; the rest is the words.

**Before you start:** `securivax.onrender.com` on the landing page, top, given ten
seconds so the 3D device has loaded. Second tab on `/boxes`. Don't sign in.

---

Hi, my name is **[name]**, and I'll be talking about **SecuriVax**, my team's
hackathon project.

SecuriVax tells a health worker whether the vaccine in front of them still works,
from the temperature that box has actually been through on the way there.

The goal is to stop two things at once: doses getting given that are already dead,
and good doses getting thrown out because nobody can prove they're fine.

Right now the only monitor on a vial is a VVM — a heat-sensitive square you read by
eye. It gets misread, and it can't see freezing at all, which is the failure that
actually happens, because ice packs go in straight out of a minus-twenty freezer.

So the system is two parts: a sensor that rides with the vaccine, and the app that
decides. Hardware first.

## The hardware

*[the hero, device large on black]*

This is the node. It sits in the cold box with the vaccine, takes a temperature and
humidity reading every five minutes, and runs for months on one small lithium cell.

*[scroll slowly — the device opens into its parts]*

Inside: the cell, our board with the ESP32 and the sensor, and a sealed case,
because it spends eight hours sitting in melting ice.

*[keep scrolling into "Tag it"]*

Every box and every carrier gets an NFC sticker. Tap the carrier, tap the box, and
that box is loaded onto that carrier. That's the chain of custody, and it's any
phone held against a sticker — no app to install, which matters, because you are
not getting an app onto every health worker's phone in a district.

*[scroll into "Sense it"]*

Here's the node reading the box, and the reading landing on a phone. It holds every
reading in flash until the server acknowledges it — about two weeks' worth — so a
village with no signal doesn't cost you the trip.

## The app

*[switch to the /boxes tab]*

That's the sensor. Here's what decides.

Eleven boxes, and they don't all get the same verdict — because the vaccines in
them fail in different ways. Oral polio is the most heat-sensitive vaccine there
is. The liquid pentavalent below it is destroyed by freezing instead. A malaria
rapid test is fine sitting at 30 degrees but is ruined below zero. One 2-to-8
threshold for all of them is just wrong, and that's what everyone uses.

You can filter by verdict, search by product or place, and there's a map view if
you want to see where they all are.

*[open BOX-KO-0915]*

Here's the one that makes the point. Sixty doses of pentavalent. **Quarantine** —
hold it, shake test before use. And every box page is built the same way: the
verdict, what to do about it, and then the evidence under it.

*[open Why]*

It hit minus 2.4 degrees and stayed under zero for ninety minutes, starting right
after it was packed, on a motorbike from Kombewa to Kisumu West.

*[point at Likely cause]*

And it names the cause: the ice packs went in frozen. Condition them until they
sweat. That's something a supply officer can change tomorrow morning.

Now — the VVM on that vial looks perfect. It's a heat indicator, and this box never
got hot. A freeze indicator would have told you "freeze" for the whole trip: not
when, not where, not which vaccine. Those sixty doses get injected, and they don't
work.

*[scroll the box page — don't stop moving]*

Under that you've got the full temperature trace, the custody record of everyone
who handled it, and **Scan the VVM label** — you photograph the vial with your
phone, and the camera reads the label and cross-checks it against the temperature
record. Two independent witnesses. There's also a "what would this have done to a
different vaccine" view, because the same trip isn't equally bad for everything.

Briefly, how the verdict is made. Each vaccine has a shelf life that burns down
faster the warmer it gets. We compute that with the Arrhenius equation — the same
chemistry the WHO uses to grade VVMs — so an hour at 30 degrees costs OPV more than
a day at 5. Freezing is a separate check, because it's a different failure. And we
re-run every verdict across sensor error and batch variation, so what you see is
how many scenarios it survives, not a confidence number we made up.

*[go to /live]*

This is live — every reading from every node as it reaches the server. Tap a
carrier and you get its own trace.

*[go to /climate]*

And this is the forecast side. Heat risk on the map for the places we ship to, and
for each carrier a digital twin — a particle filter that learns how fast that
specific cold box actually loses its ice from its own past trips, then forecasts
when it'll leave 2 to 8 degrees, with a range rather than a single number.

## Close

A VVM tells you a vial got hot. We tell you whether this vaccine still works, when
it was damaged, and what to fix — without binning the good stock, which is the part
that decides whether anyone actually uses the thing.

---

## Being straight about limits

- **The node is a stretch goal, and the bench sensor didn't survive the build.** It
  replays a recorded profile; everything downstream — ingest, budget, verdict — is
  live. You're leading with hardware, so say this yourself rather than be asked.
- **The stability curves are illustrative**, anchored on published VVM grades, not a
  manufacturer's dossier. Right method, approximate constants.
- **Confidence is scenario coverage, not a calibrated probability.** "Holds in 90%
  of scenarios", never "90% sure".
- **The backtest is simulated trips on real weather**, not a field trial.

## If you have to cut

In this order: the `/climate` stop, the "what would this have done to a different
vaccine" sentence, the NFC paragraph, then the Arrhenius paragraph. **Never cut
impact** — it's the only part that answers "so what".

## May catch you out

Under *Why*, the reason text quotes the raw figure — "heat budget used up (323%)" —
while the headline says 100%. Both right: that box spent 3.2 times its budget.

## Don't

Stop moving. Every page after BOX-KO-0915 is a ten-second flyover — you're showing
breadth, not explaining it. Don't open `/tags` or `/stage` unless asked. Don't
linger on the exploded device: one pass, keep scrolling. Don't teach chemistry
beyond that one paragraph.

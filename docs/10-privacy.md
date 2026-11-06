# SafeRaah — Privacy

SafeRaah is built so that **your location stays on your phone**. This page says exactly what leaves the phone, when, and when it is deleted.

## Kept only on your phone
- Your trusted contacts, your name, your settings (mode, layers, voice).
- A random app id (not linked to your phone number, account or name).
- Route planning, turn-by-turn guidance, voice, check-ins and SOS all run on the phone. Planning a route sends nothing anywhere.
- **Delete my data on this phone** (☰ → Trusted contacts & settings) removes all of it.

## Sent to the SafeRaah server only during a trip
Only when you start a journey, and only so your family's live link works and the app can check that you really reached:

| What | Why | Deleted |
|---|---|---|
| Your GPS points | live link, arrival check, "Are you OK?" | **the moment the trip ends** (arrival or End) |
| The route and destination | live link | the moment the trip ends |
| Your name (if you typed one) | shown on the live link | the moment the trip ends |
| The list of street segments | lets your optional answer count for those streets | when you answer, or 1 hour after the trip if you don't |
| "Reached safely" status | so family opening the link later sees you arrived | 1 hour after the trip |
| A trip that never ended (app closed) | — | after 12 hours |

After the trip **no GPS points, route, destination or name exist on the server**, and the server refuses to add any location to a finished trip.

## The two questions after a trip (optional)
1. How safe did the route feel? (1–5)
2. What did you notice? (well lit, busy, dark, deserted…)

Only trips that really reached the destination can answer. If you answer, each street of the route gets one vote stored as `(street, rating, what you noticed, day)` under a one-way pseudonym — no trip, no time of day, no comment, no app id. The pseudonym for votes is different from the one for live reports, so the two cannot be linked. If you skip, nothing is kept.

## Live reports
A report ("No street lights", "Harassment"…) is a spot on the map, its type and a one-way pseudonym (to stop one phone flooding the map). It is deleted when it expires (2–12 hours).

## Not collected
No account, phone number, email, contacts list, advertising id or analytics. The server does not log requests or IP addresses. (The website host, GitHub Pages, keeps its own standard access logs.) SMS to your contacts is sent from your own phone, unless whoever runs the server turns on server SMS.

# CampusPass

A campus event platform built for Laharika's software engineering portfolio. Students discover events, reserve one place per event, view a QR ticket, add an event to their calendar, and cancel before the event starts. Organizers publish events, review attendee lists, and check each ticket in once.

## Try it

[Hosted CampusPass](https://campuspass-laharika.laharikarayudu39.chatgpt.site) — currently private to the owner. This public source repository does not grant access to the hosted app.

1. Open the private hosted app and sign in with ChatGPT. The first authenticated account becomes the organizer during owner-private setup.
2. Open a sample event and select **Reserve my spot**.
3. Open **My tickets** to view the QR ticket or cancel the reservation.
4. Open **Manage events** to create an event or inspect its attendees.
5. Check in a reservation from the attendee list or paste its ticket code into **Check in a ticket**. A second check-in is rejected.

Sample events are labeled in the interface. Their dates are assigned relative to the first sign-in and are stored permanently. They are fictional examples, not real college events. No payment is collected.

## Architecture

- Frontend: React 19, TypeScript, responsive CSS, Lucide icons, native accessible modal dialogs.
- Server: Vinext route handlers running on Cloudflare Workers.
- Database: Cloudflare D1 (SQLite), with schema and versioned migrations managed by Drizzle.
- Authentication: platform-managed ChatGPT sign-in. Identity is read server-side; no passwords are stored by this app.
- QR codes: generated locally in the browser with `qrcode`, without sending tickets to an external image service.

This implementation uses Workers/D1. The SQL and concurrency design use SQLite semantics.

## Source map

| File | Responsibility |
| --- | --- |
| `app/campus-app.tsx` | Event discovery, booking, tickets, organizer screens, dialogs |
| `app/globals.css` | Desktop and mobile styling |
| `app/api/campus/route.ts` | Authenticated data access, input validation, authorization, mutations |
| `app/chatgpt-auth.ts` | Platform sign-in identity helpers |
| `lib/booking-sql.ts` | Atomic capacity check and booking upsert |
| `lib/sample-events.ts` | Initial sample data |
| `db/schema.ts` | Users, events, bookings, constraints and indexes |
| `drizzle/` | Versioned database migrations |
| `tests/test_booking.py` | Reservation concurrency and lifecycle tests |
| `tests/api-routes.cjs` | Route-handler integration tests with a local SQLite adapter |

## Important engineering decisions

### Capacity and retries

A reservation uses one atomic `INSERT ... SELECT ... ON CONFLICT` statement. The insert checks the count of non-cancelled reservations against event capacity. SQLite serializes writes, so competing writers cannot both claim the final available place. The unique `(event_id, user_id)` index prevents duplicate reservations. An existing active booking is returned on a repeated booking request.

Rebooking after cancellation reuses the booking row but rotates the unpredictable UUID ticket code. The old code becomes invalid. Checked-in reservations still occupy capacity.

### Authorization

All API access requires a server-derived authenticated identity. Booking lists are scoped to that user. Students cannot create events, inspect attendee lists, or check people in. Organizers can only access attendee lists and check-in tickets for events they own. Cancellation is scoped to the booking owner and allowed only for confirmed reservations before the event starts.

The first-user organizer bootstrap is safe only while the site is owner-private. Complete initial sign-in before changing site access. All later accounts start as students. There is no self-service organizer promotion or public account/password system.

### Check-in

A QR code opens this app with a ticket token. It does not check anyone in automatically. An authenticated event organizer must confirm the action. The final update uses `WHERE status='confirmed'`, so competing or repeated check-in requests cannot both succeed. Check-in is intentionally available before an event begins for this portfolio version; a production venue may add a check-in time window.

### Errors and timestamps

API failures produce recoverable messages. Unsaved form input stays in place. The server validates dates, category, text lengths, capacity, and request origin. Stored timestamps are UTC ISO strings; event displays and the event creation form use India Standard Time.

## Development

Node.js 22.13+ and pnpm are required. Preserve the lockfile.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm db:generate
pnpm build
python tests/test_booking.py
node tests/api-routes.cjs
```

The Cloudflare database binding is `DB`. The hosting manifest declares the logical database; the hosting platform provisions production resources. Apply migrations to a local database before local integration testing. Never apply local test identities to the hosted app. The route tests stub platform identity only in memory; production identity comes from the platform dispatcher.

In this managed environment, the supervised preview owns the development server. In a standalone checkout, consult the starter runtime scripts before choosing a local server command.

## Validation

- Six database tests cover 20 concurrent attempts at the last seat, duplicate requests, cancellation and rebooking, one-time check-in, expired-event rejection, and the count-query index.
- 29 route-handler assertions check authentication, CSRF, role/ownership boundaries, booking isolation, creation validation, reservation/cancellation, and replayed check-in. These run the actual handler code against a SQLite adapter, with the platform identity provider stubbed.
- End-to-end browser and live hosted sign-in testing were not available during this build.
- TypeScript and production build validation are required before publishing.

These checks are correctness tests, not a production load benchmark. No real user-count, performance, uptime, or scale claim is made.

## Scope and next steps

This is a working portfolio MVP. It does not include payments, email delivery, event editing/deletion, organizer invitations, a custom college login, or in-app camera scanning. Phone cameras can read the ticket QR; the organizer can also paste the ticket code or check in from the attendee list. The site starts private. Broader access must be deliberately enabled through sharing controls.

Before using it for a real college, establish organizer provisioning, institutional access rules, audit logs, backups, rate limiting, and operational monitoring. Extend the current monolithic client into smaller components as part of learning and future feature work.

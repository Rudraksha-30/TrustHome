# Trusted Local Pros: Local Service Marketplace with Trust Scoring

A two-sided MERN web app where customers book local service providers (plumbers, electricians,
cleaners, tutors and so on), and every provider carries a **transparent, multi-signal Trust Score**
instead of a single star rating.

Built for the 5th semester **Software Engineering Lab**. The project is organised so each SE topic
(requirements, design, testing, estimation, deployment) can be pointed to in the code.

## Features

| Role | What they can do |
|---|---|
| **Customer** | Register, sign in to browse providers, filter by service and city (fixed lists, no free text), see why a provider has their score, book a time slot (the provider decides how long a job blocks), track a booking, chat (edit/delete own messages), attach photos and videos to a booking, see a provider's previous-work photos, leave, edit or delete a review, report a problem (dispute), get notifications |
| **Provider** | Create and edit a listing (services from a fixed list, area, prices, time per booking), add up to 12 previous-work photos with captions to their public page, switch **Available / Not available** (only available providers are listed to customers; the time spent on each setting is tracked and shown), accept / decline / start / complete bookings, cancel with a reason, chat, watch their trust score and its breakdown change |
| **Admin** | Platform statistics, verify providers (badge), review and resolve disputes (a ruling against a provider lowers their score) |
| **Quality inspector** | Read-only quality report: trust, recent rating, cancellations, time not available, with flags when a number crosses a threshold. Cannot warn, suspend or see photos |

## The Trust Score (the project's hook)

```
raw   = 100 * ( 0.40 * completionRate
              + 0.30 * recencyWeightedRating
              + 0.20 * responseTimeScore
              + 0.10 * disputeScore )

score = 50 + (raw - 50) * confidence            confidence = min(1, completedJobs / 10)
```

| Signal | Meaning | Why this weight |
|---|---|---|
| Completion rate (40%) | completed jobs vs jobs the provider cancelled after accepting | Hardest to fake |
| Recency-weighted rating (30%) | average review, each review's weight halves every 90 days | Useful but subjective |
| Response time (20%) | 1.0 if they answer within 30 minutes, falling to 0 at 24 hours | Shows reliability |
| Dispute record (10%) | `1 - faultDisputes / completedJobs`; only disputes an **admin ruled against the provider** count | Rare events, small weight |

**Cold start:** a brand-new provider scores exactly 50 and is flagged "New provider". The score moves
toward their real record as they complete jobs, and is fully trusted after 10.

All numbers live as named constants in `server/src/services/trustScore.js`.
The formula is a pure function (no database), so it is unit-tested directly.

## Tech stack

- **Frontend:** React 19, React Router, Vite, plain CSS
- **Backend:** Node.js, Express 5, Mongoose 9
- **Database:** MongoDB (local install or MongoDB Atlas)
- **Auth:** JWT in the `Authorization` header, bcrypt password hashes, role checks (customer / provider / admin)
- **Safety:** helmet, CORS allow-list, input validation (express-validator), rate limiting on login and register
- **Tests:** Jest and Supertest, plus a browser end-to-end run during development

## Run it on your computer

You need **Node 18 or newer** and a **MongoDB database** (either a local MongoDB or a free MongoDB Atlas cluster; see `DEPLOY.md` for creating Atlas).

**1. Start the API**

```bash
cd server
cp .env.example .env     # Windows PowerShell: copy .env.example .env
```

Open `server/.env` and set:

- `MONGO_URI`: your database address
- `JWT_SECRET`: any long random text, at least 16 characters. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```bash
npm install
npm run dev              # API on http://localhost:5000  (check http://localhost:5000/api/health)
```

**2. Start the website** (a second terminal)

```bash
cd client
npm install
npm run dev              # opens on http://localhost:5173
```

In development the website forwards `/api` calls to the API automatically, so no extra setup is needed.

**3. Optional: fill it with demo data and create an admin**

```bash
cd server
npm run seed:demo        # 6 providers, 3 customers, 54 bookings, reviews, 2 disputes
```

Every demo account uses the password `Password123`: customers `aarav@demo.test`, `diya@demo.test`,
`kabir@demo.test`; providers `ravi@demo.test`, `meena@demo.test`, `anil@demo.test`,
`pooja@demo.test`, `imran@demo.test`, `sunita@demo.test`.
Use `npm run seed:demo -- --reset` to wipe and recreate the demo accounts.

Admins cannot sign up through the website. Create one yourself (choose your own email and a strong password):

```bash
# macOS / Linux / Git Bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed:admin

# Windows PowerShell
$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="a-strong-password"; npm run seed:admin
```

Quality inspectors also cannot sign up on the website. Create one the same way:

```bash
# macOS / Linux / Git Bash
INSPECTOR_EMAIL=qa@example.com INSPECTOR_PASSWORD='a-strong-password' npm run seed:inspector

# Windows PowerShell
$env:INSPECTOR_EMAIL="qa@example.com"; $env:INSPECTOR_PASSWORD="a-strong-password"; npm run seed:inspector
```

## Run the tests

```bash
cd server
npm test
```

This runs 58 tests that need no database (trust formula, booking state machine, slot overlap,
validation, auth guards, rate limiting). A further 40 end-to-end tests walk the whole journey
(register, list, book, chat, review, dispute, admin ruling) against a real database. They run only when
you give them a **throw-away** database address (each run uses its own temporary database and deletes it):

```bash
# macOS / Linux / Git Bash
TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test

# Windows PowerShell
$env:TEST_MONGO_URI="mongodb://127.0.0.1:27017"; npm test
```

## Project structure

```
server/
  src/
    models/        User, ProviderProfile, Booking, Review, Dispute, Message, Notification
    routes/        URL -> controller wiring and input validation
    controllers/   what each endpoint does
    services/      business logic, kept apart from HTTP
      trustScore.js            PURE formula (no database)
      trustScore.service.js    gathers the numbers from the database and saves the score
      bookingStateMachine.js   PURE table of allowed booking status changes and who may make them
      notify.js                creates in-app notifications
    middleware/    JWT + role checks, validation, error handling
    utils/         timeSlots.js (overlap detection)
  scripts/         seedDemo.js, seedAdmin.js
  tests/           Jest tests
client/
  src/
    pages/         Home, Providers, ProviderDetail, Login, Register, Bookings, BookingDetail,
                   MyListing, Notifications, Admin
    components/    TrustDial, SignalBars, Timeline, Chat, ProviderCard, Navbar
    api.js         the one place that talks to the server
```

A request flows `route -> validation -> controller -> service -> model`. The trust formula and the
booking rules are pure functions in `services/`, which is why they are easy to test and to change
without touching anything else.

## API summary

All responses are JSON. Send the token as `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET` and `PATCH /api/auth/me` |
| Providers | `GET /api/providers` (customer/admin only; filters `category` from the fixed list, `area`, `page`; only available providers), `GET /api/providers/meta/catalog`, `GET /api/providers/:id`, `GET /api/providers/:profileId/reviews`, `GET` and `PUT /api/providers/me/profile`, `GET` and `PATCH /api/providers/me/availability` (provider) |
| Bookings | `POST /api/bookings` (customer), `GET /api/bookings`, `GET /api/bookings/:id`, `PATCH /api/bookings/:id/status`, `GET /api/bookings/:bookingId/review`, `GET /api/bookings/:bookingId/disputes` |
| Chat | `GET` and `POST /api/bookings/:id/messages`, `PATCH` and `DELETE /api/bookings/:id/messages/:messageId` (own messages) |
| Portfolio | `GET /api/providers/:profileId/portfolio` (signed-in), `POST /api/providers/me/portfolio` (raw image body, provider), `PATCH` and `DELETE /api/providers/me/portfolio/:itemId`, `GET /api/portfolio/:id/file` (signed link) |
| Media | `GET` and `POST /api/bookings/:id/media` (raw image/video body), `GET /api/media/:id/file` (signed link), `DELETE /api/media/:id` (uploader) |
| Reviews | `POST /api/reviews` (customer, completed bookings only, one per booking), `PATCH` and `DELETE /api/reviews/:id` (author) |
| Disputes | `POST /api/disputes` (either party) |
| Notifications | `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/read-all`, `PATCH /api/notifications/:id/read` |
| Inspector | `GET /api/inspector/report?days=` (inspector or admin) |
| Admin | `GET /api/admin/stats`, `GET /api/admin/providers`, `PATCH /api/admin/providers/:id/verify`, `GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id/resolve` |

## Deploying

See **`DEPLOY.md`** for the step-by-step guide (MongoDB Atlas + Render + Vercel, all free tiers).

## Known limitations (good to state honestly in the viva)

1. **Double-booking race (NFR-3).** The overlap check and the save are two separate database steps, so two
   simultaneous "accept" clicks for overlapping slots could in theory both pass. Fine at this scale; the
   production fix is a database transaction or a slot-lock document.
2. **Provider verification is an admin toggle**, not a document upload. The admin decides and the badge appears.
3. **Notifications are in-app only** (the bell and the notifications page), not email or SMS.
4. **Chat refreshes every few seconds** (polling), not instantly with WebSockets.
5. **No payments, live GPS tracking or mobile app.** These were deliberately left as future scope.
6. **Not built from the optional extras list:** repeat-service reminders and a richer "skill-matched" ranking.
   Providers are currently ranked by Trust Score, and the category filter handles matching.
7. The end-to-end tests were run against a MongoDB-compatible server (FerretDB), not MongoDB itself.
   Run them once against your own MongoDB to confirm (command above).
8. **Deleting a chat message is permanent.** The text is erased, only a "message deleted" marker remains, so it cannot
   be used as evidence in a dispute. A production system might keep a hidden copy for admins.
9. **Photos and videos are stored inside MongoDB** (photos up to 5 MB, videos up to 15 MB; JPEG, PNG, WebP, GIF, MP4, WebM).
   Simple and fine for a demo, but Atlas's free tier is 512 MB; production would use object storage such as S3.
   iPhone HEIC photos are rejected. Files are type-checked by their real bytes, not their file name.
10. **Search uses a fixed list of 12 services.** Adding a service is one line in `server/src/services/serviceCatalog.js`.
11. **Previous-work photos are separate from booking photos.** Booking files stay private to the two people on the booking; only photos a provider uploads to their own portfolio are shown publicly (to signed-in users). Photos only, no videos, max 12.

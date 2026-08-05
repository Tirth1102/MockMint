# MockMint

A CAT previous-year-paper platform: a full-length exam environment with sectional
timers, a live question palette, and post-test analysis that goes down to the question.

Implemented from the [Claude Design prototype](https://claude.ai/design/p/fcffacf5-dea5-4687-a995-be4cdd84b4ee)
(`MockMint.dc.html`) and its companion `ARCHITECTURE.md`.

```
├── apps/
│   ├── api/        Node + Express + PostgreSQL, modular by domain
│   └── web/        Next.js App Router, CSS Modules over CSS-variable tokens
└── packages/
    └── shared/     Domain types, marking rules, percentile curve — used by both
```

## Quick start

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The web app is at http://localhost:3000, the API at http://localhost:4000.

Demo accounts created by the seed:

| Role | Email | Password |
|---|---|---|
| Student | `aarav@example.com` | `demo1234` |
| Admin | `admin@mockmint.in` | `MockMint@2026` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and web together, both watching |
| `npm run build` | Builds shared → api → web |
| `npm run typecheck` | `tsc --noEmit` across every workspace |
| `npm run db:up` / `db:down` | Postgres 16 + Redis 7 via Docker Compose |
| `npm run db:migrate` | Applies pending migrations (`-- --fresh` drops first) |
| `npm run db:seed` | Papers, question banks, demo accounts, graded history |
| `npm run db:reset` | `migrate --fresh` then `seed` |

## What the seed creates

- **28 papers** — CAT 2015–2025, two slots per year before 2020 and three from 2020.
- **1,848 questions** — each paper opens every section with the 14 authored CAT-style
  items (real stems, real worked explanations, shared RC/DI passages), then fills the
  rest deterministically. Placeholders still carry genuine section, topic, difficulty
  and marking metadata, so every analytic is computed from real responses.
- **Graded attempt history** for the demo student plus a small cohort, so the dashboard,
  results list and leaderboard are derived rather than hard-coded.

Replace the placeholders with your own bank through **Admin → Bulk upload**.

## How the exam engine works

The server owns time. When an attempt starts, `attempts.section_deadline_at` is written
with one absolute timestamp per section; the browser's countdown is display only, so a
refresh, a reconnect or a edited system clock cannot buy a candidate extra time. Sections
run strictly in order (VARC → DILR → QA), and a section is writable only while `now`
falls inside its window — `PATCH /response` rejects a write to a locked section with 409.

Answer keys never reach an in-progress client: the exam payload strips `correct_option`,
`tita_answer` and `explanation`, and the review endpoint refuses to serve them until
`attempts.status = 'submitted'`.

Marking, per `ARCHITECTURE.md` §3:

| Type | Correct | Incorrect | Unattempted |
|---|---|---|---|
| MCQ | +3 | −1 | 0 |
| TITA | +3 | 0 | 0 |

Scoring lives in `packages/shared/src/marking.ts` and is used by the live engine and the
seeder alike, so seeded history and real history are graded identically.

## Percentile

Interpolated from a fixed score→percentile curve
(`packages/shared/src/percentile.ts`), shared by API and UI so a displayed percentile can
never disagree with a stored one. This is an estimate, not a cohort rank — the production
path is a materialised score→rank view per paper, refreshed hourly.

## Security

- Argon2id password hashing (19 MiB / t=2 / p=1).
- 15-minute access JWT in memory only — never `localStorage`, so XSS cannot read it.
- Rotating refresh token in an httpOnly cookie, hashed at rest, allowlisted in Redis and
  recorded in Postgres so logout genuinely revokes. Reusing a rotated token yields 401.
- Blocking a user or changing a password revokes every live session immediately.
- Role middleware on all `/api/admin/*`; every mutating admin action writes an audit row.
- Rate limits: 5/min on credential endpoints, 120/min on autosave.
- Zod validation on every request; parameterised queries throughout.
- Attempt ownership is checked on every response write and result read.

## Theming

Tokens are ported verbatim from the prototype's `:root` / `[data-cattheme="dark"]` blocks
into `apps/web/src/app/globals.css`. Dark mode flips `data-cattheme` on `<html>`; an
inline script in the root layout applies the stored choice before first paint, so there is
no flash of the wrong theme. Everything else is CSS Modules.

## Redis

Treated as a cache, never as the source of truth. If it is unreachable the API logs a
warning once and continues against Postgres alone, so `npm run dev` works without it.

## Known gaps

Specified in `ARCHITECTURE.md` but not built here:

- Email delivery. Password-reset tokens are generated and stored correctly; in
  development the token is logged to the API console instead of emailed.
- Email verification, OAuth, full-screen proctoring and offline reconnect.
- S3 image upload for question images (the attach control is disabled pending the
  signed-URL endpoint).
- The BullMQ worker — percentile recompute currently runs inline off the shared curve.

One `npm audit` advisory remains: a transitive `uuid` inside `exceljs`, affecting only the
v3/v5/v6 `buf` code path. ExcelJS uses v4, so it is not reachable; the only fix offered is
a downgrade to exceljs 3.4.0, which is worse.

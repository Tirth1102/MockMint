# MockMint — Architecture, Schema & API

Companion doc to the `MockMint.dc.html` prototype (CAT previous-year test platform). The prototype is the front-end
source of truth for screens, states and marking rules; this doc is the spec for the
services behind it.

---

## 1. Architecture

```
Client (React/Next.js, Tailwind)
  ├── /auth            login, signup, forgot, verify
  ├── /app             student shell: dashboard, papers, exam, result, profile
  └── /admin           RBAC-gated shell: bank, papers, upload, users, analytics
        │
        ├─ REST/JSON over HTTPS, Bearer access token
        ▼
API (Node + Express, modular by domain)
  auth · users · papers · questions · attempts · analytics · admin · uploads
        │
        ├── PostgreSQL (relational: users, papers, questions, attempts, responses)
        ├── Redis      (sessions/refresh allowlist, live attempt state, rate limits)
        ├── S3         (question images, bulk-upload files, exported reports)
        └── Worker     (BullMQ: bulk import validation, percentile recompute, email)
```

Key decisions

- **Postgres over Mongo.** Scoring, percentile ranking and section aggregates are
  set-based queries over a fixed schema; relational wins on correctness and reporting.
- **Live attempt state in Redis**, flushed to Postgres every 5s and on every answer.
  Server holds authoritative `section_deadline_at` timestamps — the client clock is
  display only, so refresh/reconnect cannot buy time.
- **Server-side scoring only.** `correct_option` and `tita_answer` are never sent to the
  client before submission; the exam payload strips them.
- **Percentile** from a materialised view of score→rank per paper, refreshed hourly.

---

## 2. Database schema (PostgreSQL)

```sql
users(
  id uuid pk, name text, email citext unique, password_hash text,
  role text check (role in ('student','admin')) default 'student',   -- admin: admin@mockmint.in
  photo_url text, email_verified_at timestamptz, blocked_at timestamptz,
  target_percentile numeric, created_at timestamptz default now()
)

papers(
  id uuid pk, year int, slot int, title text,
  duration_min int default 120, total_marks int default 198,
  difficulty text, status text check (status in ('draft','live','retired')) default 'draft',
  published_at timestamptz, created_by uuid references users,
  unique(year, slot)
)

paper_sections(
  id uuid pk, paper_id uuid references papers on delete cascade,
  key text check (key in ('VARC','DILR','QA')), position int,
  question_count int, duration_min int default 40
)

passages(id uuid pk, paper_id uuid, section_key text, body text, label text)

questions(
  id uuid pk, paper_id uuid references papers on delete cascade,
  section_key text, position int, passage_id uuid null references passages,
  type text check (type in ('MCQ','TITA')),
  stem text, options jsonb,              -- ["...","...","...","..."] for MCQ
  correct_option smallint null,          -- 0..3 for MCQ
  tita_answer text null,                 -- exact-match string for TITA
  explanation text, difficulty text, topic text,
  marks numeric default 3, negative_marks numeric default 1,
  image_url text, created_at timestamptz default now(),
  unique(paper_id, section_key, position)
)

attempts(
  id uuid pk, user_id uuid references users, paper_id uuid references papers,
  status text check (status in ('in_progress','submitted','expired')),
  current_section smallint, section_deadline_at timestamptz[],
  started_at timestamptz, submitted_at timestamptz, auto_submitted bool default false,
  score numeric, correct int, wrong int, attempted int, accuracy numeric,
  percentile numeric, total_time_sec int
)

responses(
  attempt_id uuid references attempts on delete cascade,
  question_id uuid references questions,
  answer jsonb,             -- {"option":2} | {"text":"23"}
  marked_for_review bool default false, visited bool default false,
  time_spent_sec int default 0, is_correct bool, marks_awarded numeric,
  primary key (attempt_id, question_id)
)

section_results(attempt_id uuid, section_key text, attempted int, correct int,
  wrong int, skipped int, accuracy numeric, score numeric, time_sec int,
  primary key (attempt_id, section_key))

bookmarks(user_id uuid, question_id uuid, created_at timestamptz,
  primary key (user_id, question_id))

practice_log(user_id uuid, day date, sets int, primary key (user_id, day))
notifications(id uuid pk, user_id uuid null, kind text, body text, read_at timestamptz)
upload_jobs(id uuid pk, admin_id uuid, filename text, format text,
  total_rows int, valid_rows int, warnings jsonb, errors jsonb, status text)
```

Indexes: `attempts(user_id, submitted_at desc)`, `responses(question_id)`,
`questions(paper_id, section_key, position)`, `attempts(paper_id, score desc)`.

---

## 3. Marking rules (implemented in the prototype)

| Type | Correct | Incorrect | Unattempted |
|---|---|---|---|
| MCQ  | +3 | −1 | 0 |
| TITA | +3 |  0 | 0 |

Sectional lock: 40 minutes per section, in order VARC → DILR → QA. A section whose
timer reaches zero is read-only; when the last section expires the attempt is
auto-submitted. Percentile is interpolated from the paper's score→rank curve.

---

## 4. API endpoints

**Auth**
```
POST   /api/auth/register            {name,email,password} → 201 {user, tokens}
POST   /api/auth/login               {email,password}      → {user, tokens}
POST   /api/auth/refresh             {refreshToken}        → {accessToken}
POST   /api/auth/logout              revokes refresh token
POST   /api/auth/forgot-password     {email}   → 202 (always, no user enumeration)
POST   /api/auth/reset-password      {token,password}
GET    /api/auth/verify-email/:token
```

**Student**
```
GET    /api/me                       profile + aggregate stats
PATCH  /api/me                       {name,photo_url,target_percentile}
POST   /api/me/password              {current,next}
GET    /api/papers?year=&status=live grouped by year → slots with meta
GET    /api/papers/:id               paper meta + section layout (no questions)
GET    /api/dashboard                stat cards, trend, recent attempts, coach copy
GET    /api/bookmarks · POST /api/bookmarks/:questionId · DELETE same
GET    /api/practice/calendar?days=182
```

**Exam engine**
```
POST   /api/attempts                 {paperId} → attempt + questions (answers stripped)
                                     409 if an in_progress attempt exists
GET    /api/attempts/active          resume payload: responses, deadlines, cursor
PATCH  /api/attempts/:id/response    {questionId, answer|null, markedForReview,
                                      visited, timeSpentSec}   ← autosave, idempotent
POST   /api/attempts/:id/section     {sectionKey}  advance/validate lock
POST   /api/attempts/:id/submit      {reason:'manual'|'timeup'} → result id
```

**Results**
```
GET    /api/attempts/:id/result      overall + section_results + charts payload
GET    /api/attempts/:id/review?filter=all|correct|wrong|skipped|bookmarked
GET    /api/attempts/:id/suggestions generated coaching items
GET    /api/results?page=            attempt history
GET    /api/leaderboard?window=month
```

**Admin** (all require `role=admin`)
```
GET    /api/admin/overview           users, active, papers, questions, attempts, avg
GET    /api/admin/questions?section=&q=&page=
POST   /api/admin/questions · PATCH /api/admin/questions/:id · DELETE same
POST   /api/admin/papers · PATCH /api/admin/papers/:id
POST   /api/admin/papers/:id/publish · /unpublish
POST   /api/admin/uploads            multipart file → upload_job (async validate)
GET    /api/admin/uploads/:jobId     row-level warnings + errors
POST   /api/admin/uploads/:jobId/commit
GET    /api/admin/users?q=&page= · POST /api/admin/users/:id/block · /reset-password
DELETE /api/admin/users/:id
GET    /api/admin/analytics          growth, DAU, completion, difficulty accuracy
```

---

## 5. Bulk upload contract

Accepted: `.xlsx` (sheet 1, header row), `.csv` (UTF-8), `.json` (array of objects).

```
section        VARC | DILR | QA          (required)
type           MCQ | TITA                (required)
passage_id     optional — groups RC / DI sets
stem           question text             (required)
option_a..d    required when type = MCQ
correct        A|B|C|D, or exact string for TITA   (required)
explanation    shown in post-test review
difficulty     Easy | Medium | Hard      (default Medium, warning if absent)
topic          free text, drives analytics
marks          default 3
negative       default 1 (forced to 0 for TITA)
```

Validation runs before any write: unknown section → error, `correct` outside the
supplied options → error, missing explanation or difficulty → warning. Valid rows
import; errored rows are returned for correction. The whole job is one transaction.

---

## 6. Security

- Argon2id password hashing; short-lived access JWT (15 min) + rotating refresh token
  in an httpOnly cookie, allowlisted in Redis so logout truly revokes.
- Role-based middleware on every `/api/admin/*` route; admin actions written to an
  audit log.
- Rate limits: 5/min on login and forgot-password, 60/min on response autosave.
- Attempt ownership checked on every response and result read; answer keys are only
  joined in after `attempts.status = 'submitted'`.
- Zod request validation, parameterised queries, signed S3 upload URLs.

---

## 7. Prototype ↔ spec gaps

- Questions are 15 authored CAT-style items plus generated placeholders that carry real
  section, topic, difficulty and marking metadata, so every analytic is computed from
  real responses. Swap in your bank via the admin bulk upload contract above.
- Email verification, OAuth, full-screen proctoring and offline reconnect are specified
  here but not simulated in the prototype.
- Percentile is an interpolated estimate, not a real cohort rank.

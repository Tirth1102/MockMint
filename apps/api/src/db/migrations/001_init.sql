-- MockMint initial schema. Mirrors ARCHITECTURE.md §2.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------- users

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  email             citext      NOT NULL UNIQUE,
  password_hash     text        NOT NULL,
  role              text        NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  photo_url         text,
  email_verified_at timestamptz,
  blocked_at        timestamptz,
  target_percentile numeric(5, 2),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Rotating refresh tokens. Redis holds the hot allowlist; this table is the durable
-- record so `logout` still revokes when Redis is cold or unavailable.
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- papers

CREATE TABLE papers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year         int         NOT NULL,
  slot         int         NOT NULL,
  title        text        NOT NULL,
  duration_min int         NOT NULL DEFAULT 120,
  total_marks  int         NOT NULL DEFAULT 198,
  difficulty   text        NOT NULL DEFAULT 'Moderate',
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'retired')),
  published_at timestamptz,
  created_by   uuid REFERENCES users ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, slot)
);

CREATE TABLE paper_sections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id       uuid NOT NULL REFERENCES papers ON DELETE CASCADE,
  key            text NOT NULL CHECK (key IN ('VARC', 'DILR', 'QA')),
  position       int  NOT NULL,
  question_count int  NOT NULL,
  duration_min   int  NOT NULL DEFAULT 40,
  UNIQUE (paper_id, key)
);

CREATE TABLE passages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id    uuid NOT NULL REFERENCES papers ON DELETE CASCADE,
  section_key text NOT NULL CHECK (section_key IN ('VARC', 'DILR', 'QA')),
  body        text NOT NULL,
  label       text
);
CREATE INDEX passages_paper_idx ON passages (paper_id);

CREATE TABLE questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id       uuid    NOT NULL REFERENCES papers ON DELETE CASCADE,
  code           text    NOT NULL,
  section_key    text    NOT NULL CHECK (section_key IN ('VARC', 'DILR', 'QA')),
  position       int     NOT NULL,
  passage_id     uuid REFERENCES passages ON DELETE SET NULL,
  type           text    NOT NULL CHECK (type IN ('MCQ', 'TITA')),
  stem           text    NOT NULL,
  options        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  correct_option smallint CHECK (correct_option BETWEEN 0 AND 3),
  tita_answer    text,
  explanation    text    NOT NULL DEFAULT '',
  difficulty     text    NOT NULL DEFAULT 'Medium' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  topic          text    NOT NULL DEFAULT '',
  marks          numeric(4, 1) NOT NULL DEFAULT 3,
  negative_marks numeric(4, 1) NOT NULL DEFAULT 1,
  image_url      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, section_key, position),
  -- An MCQ needs an option index; a TITA needs an exact-match string.
  CONSTRAINT questions_answer_present CHECK (
    (type = 'MCQ'  AND correct_option IS NOT NULL) OR
    (type = 'TITA' AND tita_answer IS NOT NULL AND tita_answer <> '')
  )
);
CREATE INDEX questions_paper_section_pos_idx ON questions (paper_id, section_key, position);
CREATE INDEX questions_topic_idx ON questions (topic);

-- ---------------------------------------------------------------- attempts

CREATE TABLE attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  paper_id            uuid NOT NULL REFERENCES papers ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'submitted', 'expired')),
  current_section     smallint    NOT NULL DEFAULT 0,
  -- One deadline per section, in section order. Server-authoritative: the client
  -- clock is display only, so a refresh or reconnect cannot buy time.
  section_deadline_at timestamptz[] NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  auto_submitted      boolean     NOT NULL DEFAULT false,
  score               numeric(6, 1),
  correct             int,
  wrong               int,
  attempted           int,
  accuracy            numeric(5, 2),
  percentile          numeric(5, 2),
  total_time_sec      int
);
CREATE INDEX attempts_user_submitted_idx ON attempts (user_id, submitted_at DESC);
CREATE INDEX attempts_paper_score_idx ON attempts (paper_id, score DESC);
-- At most one live attempt per user: POST /api/attempts returns 409 against this.
CREATE UNIQUE INDEX attempts_one_in_progress_idx
  ON attempts (user_id) WHERE status = 'in_progress';

CREATE TABLE responses (
  attempt_id       uuid NOT NULL REFERENCES attempts ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  answer           jsonb,          -- {"option":2} | {"text":"23"} | NULL when cleared
  marked_for_review boolean NOT NULL DEFAULT false,
  visited          boolean NOT NULL DEFAULT false,
  time_spent_sec   int     NOT NULL DEFAULT 0,
  is_correct       boolean,
  marks_awarded    numeric(4, 1),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX responses_question_idx ON responses (question_id);

CREATE TABLE section_results (
  attempt_id  uuid NOT NULL REFERENCES attempts ON DELETE CASCADE,
  section_key text NOT NULL CHECK (section_key IN ('VARC', 'DILR', 'QA')),
  attempted   int  NOT NULL DEFAULT 0,
  correct     int  NOT NULL DEFAULT 0,
  wrong       int  NOT NULL DEFAULT 0,
  skipped     int  NOT NULL DEFAULT 0,
  accuracy    numeric(5, 2) NOT NULL DEFAULT 0,
  score       numeric(6, 1) NOT NULL DEFAULT 0,
  max_marks   numeric(6, 1) NOT NULL DEFAULT 0,
  time_sec    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, section_key)
);

-- ---------------------------------------------------------------- engagement

CREATE TABLE bookmarks (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE practice_log (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  day     date NOT NULL,
  sets    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE notifications (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users ON DELETE CASCADE,   -- NULL = broadcast
  kind    text NOT NULL DEFAULT 'info',
  body    text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE upload_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  paper_id   uuid REFERENCES papers ON DELETE SET NULL,
  filename   text NOT NULL,
  format     text NOT NULL,
  total_rows int  NOT NULL DEFAULT 0,
  valid_rows int  NOT NULL DEFAULT 0,
  warnings   jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors     jsonb NOT NULL DEFAULT '[]'::jsonb,
  parsed     jsonb NOT NULL DEFAULT '[]'::jsonb,
  status     text  NOT NULL DEFAULT 'validated'
               CHECK (status IN ('validated', 'committed', 'discarded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid REFERENCES users ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

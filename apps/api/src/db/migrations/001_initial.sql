CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','USER')),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  phone TEXT,
  profile_image_key TEXT,
  time_zone TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uidx ON users (lower(email));

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_expiry_idx ON auth_sessions(user_id, expires_at);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_expiry_idx ON password_reset_tokens(user_id, expires_at);

CREATE TABLE meetups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  public_code INTEGER NOT NULL UNIQUE CHECK (public_code BETWEEN 10000000 AND 99999999),
  join_token_hash TEXT NOT NULL UNIQUE,
  join_token_ciphertext TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  source_time_zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meetups_owner_starts_idx ON meetups(owner_id, starts_at DESC);
CREATE INDEX meetups_status_starts_idx ON meetups(status, starts_at);

CREATE TABLE meetup_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_via TEXT NOT NULL CHECK (joined_via IN ('CODE','LINK')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at TIMESTAMPTZ,
  UNIQUE(meetup_id, user_id)
);
CREATE UNIQUE INDEX meetup_members_meetup_user_uidx ON meetup_members(meetup_id, user_id);
CREATE INDEX meetup_members_user_joined_idx ON meetup_members(user_id, joined_at DESC);
CREATE INDEX meetup_members_meetup_joined_idx ON meetup_members(meetup_id, joined_at);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  prompt TEXT NOT NULL CHECK (char_length(prompt) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(meetup_id, position),
  UNIQUE(meetup_id, id)
);

CREATE TABLE question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 4),
  label TEXT NOT NULL CHECK (char_length(label) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, position),
  UNIQUE(question_id, id)
);

CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meetup_id UUID NOT NULL REFERENCES meetups(id) ON DELETE RESTRICT,
  question_id UUID NOT NULL,
  option_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id, question_id),
  FOREIGN KEY(meetup_id, question_id) REFERENCES questions(meetup_id, id),
  FOREIGN KEY(question_id, option_id) REFERENCES question_options(question_id, id),
  FOREIGN KEY(meetup_id, user_id) REFERENCES meetup_members(meetup_id, user_id)
);
CREATE INDEX answers_question_option_idx ON answers(question_id, option_id);
CREATE INDEX answers_meetup_question_idx ON answers(meetup_id, question_id);
CREATE INDEX answers_user_meetup_idx ON answers(user_id, meetup_id);

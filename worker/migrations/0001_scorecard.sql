-- Extras > Scorecard (src/scorecard.js), phase 2 of SCORECARD-PLAN.md: players, course files, rounds.

-- A player: "owner" for Nick (his admin token, on any device), or a random id for a visitor
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- What points at a player: a browser's visitor id, or a recovery code, both hashed (never stored as is)
CREATE TABLE player_keys (
  key_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'browser' | 'code'
  created_at TEXT NOT NULL
);
CREATE INDEX player_keys_player ON player_keys (player_id);

-- A course someone has checked and approved, and its newest version
CREATE TABLE courses (
  id TEXT PRIMARY KEY,               -- 'pecan-hollow', 'api:<OpenGolfAPI id>', ...
  name TEXT NOT NULL,
  place TEXT,
  version INTEGER NOT NULL,
  owner_checked INTEGER NOT NULL DEFAULT 0,  -- Nick has approved a version (visitors can't replace it then)
  updated_at TEXT NOT NULL
);
-- Every approved version of a course file (par, handicaps, tees with yardages, the card template...), kept
CREATE TABLE course_records (
  course_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,                -- the course, as JSON
  player_id TEXT NOT NULL,           -- who approved it
  owner INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (course_id, version)
);

-- A round: its totals kept here for cheap lists and trends; the course as it was played kept with it, so editing
-- the course file later never changes an old round
CREATE TABLE rounds (
  id TEXT PRIMARY KEY,               -- made on the phone, so a round exists before the server hears of it
  player_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_name TEXT,
  course_version INTEGER,
  tee TEXT,                         -- the tee's key ('gentlemen')
  tee_name TEXT,                    -- and its name ('Gentlemen')
  holes TEXT NOT NULL,               -- JSON list of the hole numbers played, e.g. [1..18] or [10..18]
  player_name TEXT,
  played_on TEXT NOT NULL,           -- YYYY-MM-DD where it was played
  played_at TEXT,                    -- the start time (ISO)
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,       -- the phone's clock (ms) at its last change: newer wins
  strokes INTEGER, par INTEGER, putts INTEGER,
  fir_hit INTEGER, fir_left INTEGER, fir_right INTEGER, fir_total INTEGER,
  gir INTEGER, gir_total INTEGER, penalties INTEGER, holes_done INTEGER,
  on_site INTEGER NOT NULL DEFAULT 0, -- Nick's round shown on his Golf page and the home Lately strip
  course TEXT                         -- JSON
);
CREATE INDEX rounds_player ON rounds (player_id, played_on);
CREATE INDEX rounds_site ON rounds (on_site, played_on);

CREATE TABLE round_holes (
  round_id TEXT NOT NULL,
  hole INTEGER NOT NULL,
  par INTEGER, yards INTEGER, hcp INTEGER,
  strokes INTEGER, putts INTEGER,
  fairway TEXT,                      -- 'hit' | 'left' | 'right' | NULL (par 3s, or not entered)
  gir INTEGER,                       -- green in regulation, as shown (worked out, or set by hand)
  gir_set INTEGER,                   -- 1/0 when set by hand, NULL when worked out
  penalties INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, hole)
);

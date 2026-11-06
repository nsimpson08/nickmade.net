-- "Get notified" (src/fans.js, Nick 2026-10-22): visitors' phones and browsers signed up for notifications when Nick
-- posts. No names or accounts: a browser's push subscription (its push service address and keys) and what it wants.
CREATE TABLE fans (
  endpoint TEXT PRIMARY KEY,        -- the push service's address for that browser
  sub TEXT NOT NULL,                -- the whole subscription (JSON: endpoint, keys.p256dh, keys.auth)
  topics TEXT NOT NULL,             -- JSON list: any of "movies", "games", "photos", "site"
  created TEXT NOT NULL,
  updated TEXT NOT NULL
);

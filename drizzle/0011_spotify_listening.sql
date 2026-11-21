ALTER TABLE profiles ADD COLUMN spotify_track TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN spotify_artist TEXT;
--> statement-breakpoint
CREATE TABLE spotify_connections (
  account_id TEXT PRIMARY KEY REFERENCES profiles(account_id) ON DELETE CASCADE,
  connection_id TEXT,
  credentials TEXT,
  refresh_until INTEGER NOT NULL DEFAULT 0,
  pending_state TEXT,
  pending_until INTEGER
);

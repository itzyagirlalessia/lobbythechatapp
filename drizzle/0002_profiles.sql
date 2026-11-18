CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT,
  bio TEXT NOT NULL DEFAULT '',
  color INTEGER NOT NULL DEFAULT 0,
  game TEXT NOT NULL DEFAULT '',
  music TEXT NOT NULL DEFAULT '',
  steam TEXT NOT NULL DEFAULT '',
  lastfm TEXT NOT NULL DEFAULT '',
  spotify TEXT NOT NULL DEFAULT '',
  share_activity INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
ALTER TABLE members ADD COLUMN account_id TEXT;

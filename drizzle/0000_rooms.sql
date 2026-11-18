CREATE TABLE rooms (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE,
  ai_key TEXT,
  ai_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX members_room ON members(room_id, last_seen);
--> statement-breakpoint
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  member_id TEXT REFERENCES members(id),
  kind TEXT NOT NULL DEFAULT 'person',
  text TEXT NOT NULL,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, member_id, request_id)
);
--> statement-breakpoint
CREATE INDEX messages_room ON messages(room_id, id);
--> statement-breakpoint
CREATE INDEX messages_member ON messages(member_id, created_at);

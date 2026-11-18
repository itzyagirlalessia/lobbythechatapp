CREATE TABLE voice_channels (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, name)
);
--> statement-breakpoint
CREATE TABLE voice_members (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  channel TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  actor TEXT NOT NULL UNIQUE,
  last_seen INTEGER NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  deafened INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX voice_members_channel ON voice_members (room_id, channel, last_seen);
--> statement-breakpoint
CREATE INDEX voice_members_seen ON voice_members (last_seen);
--> statement-breakpoint
CREATE TABLE voice_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL REFERENCES voice_members(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL REFERENCES voice_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sdp TEXT NOT NULL,
  UNIQUE (sender, recipient, kind)
);
--> statement-breakpoint
CREATE INDEX voice_signals_recipient ON voice_signals (recipient, id);

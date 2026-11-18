CREATE TABLE channel_settings (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  slow_seconds INTEGER NOT NULL DEFAULT 0 CHECK (slow_seconds IN (0, 5, 10, 30, 60, 120)),
  PRIMARY KEY (room_id, channel)
);
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN status_text TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN status_until INTEGER;
--> statement-breakpoint
CREATE INDEX messages_room_recent_posts ON messages(room_id, channel, created_at, member_id) WHERE kind = 'person';

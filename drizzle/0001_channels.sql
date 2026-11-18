CREATE TABLE channels (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, name)
);
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN hidden_at INTEGER;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN moderation_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN ai_channel TEXT;
--> statement-breakpoint
CREATE INDEX messages_channel ON messages(room_id, channel, id);

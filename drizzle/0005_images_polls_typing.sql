ALTER TABLE messages ADD COLUMN image_key TEXT;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN image_alt TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE members ADD COLUMN typing_channel TEXT;
--> statement-breakpoint
ALTER TABLE members ADD COLUMN typing_until INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX messages_image ON messages(image_key);
--> statement-breakpoint
CREATE TABLE message_polls (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id),
  options_json TEXT NOT NULL,
  closed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE poll_votes (
  message_id INTEGER NOT NULL REFERENCES message_polls(message_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  PRIMARY KEY (message_id, actor)
);

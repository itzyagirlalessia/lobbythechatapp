ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id);
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN pinned_at INTEGER;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN invite_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  actor TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, actor, emoji)
);
--> statement-breakpoint
CREATE INDEX pinned_messages ON messages(room_id, channel, pinned_at) WHERE pinned_at IS NOT NULL;

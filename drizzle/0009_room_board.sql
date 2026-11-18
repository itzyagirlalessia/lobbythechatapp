CREATE TABLE room_board_items (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  kind TEXT NOT NULL CHECK (kind IN ('event', 'task', 'announcement')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL REFERENCES members(id),
  owner_actor TEXT NOT NULL,
  starts_at INTEGER,
  duration INTEGER NOT NULL DEFAULT 60,
  location TEXT NOT NULL DEFAULT '',
  assignee_id TEXT REFERENCES members(id),
  completed INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX room_board_items_room ON room_board_items(room_id, updated_at);
--> statement-breakpoint
CREATE TABLE room_event_rsvps (
  event_id TEXT NOT NULL REFERENCES room_board_items(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  response TEXT NOT NULL CHECK (response IN ('going', 'maybe', 'declined')),
  PRIMARY KEY (event_id, actor)
);
--> statement-breakpoint
CREATE TABLE room_queue (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  channel TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'reminder')),
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  message_id INTEGER REFERENCES messages(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'canceled', 'dismissed')),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX room_queue_due ON room_queue(room_id, state, due_at);
--> statement-breakpoint
CREATE INDEX room_queue_actor ON room_queue(room_id, actor, created_at);

CREATE TABLE friendships (
  first_account TEXT NOT NULL REFERENCES profiles(account_id),
  second_account TEXT NOT NULL REFERENCES profiles(account_id),
  requester TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (first_account, second_account)
);
--> statement-breakpoint
CREATE TABLE account_blocks (
  blocker TEXT NOT NULL REFERENCES profiles(account_id),
  blocked TEXT NOT NULL REFERENCES profiles(account_id),
  PRIMARY KEY (blocker, blocked)
);
--> statement-breakpoint
CREATE TABLE direct_threads (
  id TEXT PRIMARY KEY NOT NULL,
  first_account TEXT NOT NULL REFERENCES profiles(account_id),
  second_account TEXT NOT NULL REFERENCES profiles(account_id),
  first_read INTEGER NOT NULL DEFAULT 0,
  second_read INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (first_account, second_account)
);
--> statement-breakpoint
CREATE TABLE direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES direct_threads(id),
  account_id TEXT NOT NULL REFERENCES profiles(account_id),
  text TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  UNIQUE (thread_id, account_id, request_id)
);
--> statement-breakpoint
CREATE INDEX direct_messages_thread ON direct_messages(thread_id, id);
--> statement-breakpoint
CREATE TABLE room_bans (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  actor TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, actor)
);

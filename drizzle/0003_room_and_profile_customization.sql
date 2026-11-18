ALTER TABLE profiles ADD COLUMN avatar_key TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN banner_key TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN details_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN description TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN accent INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN icon_key TEXT;
--> statement-breakpoint
ALTER TABLE channels ADD COLUMN section TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN edited_at INTEGER;
--> statement-breakpoint
CREATE INDEX profiles_avatar ON profiles(avatar_key);
--> statement-breakpoint
CREATE INDEX profiles_banner ON profiles(banner_key);
--> statement-breakpoint
CREATE INDEX rooms_icon ON rooms(icon_key);
--> statement-breakpoint
CREATE INDEX members_account_room ON members(account_id, room_id);

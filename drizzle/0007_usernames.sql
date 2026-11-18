ALTER TABLE profiles ADD COLUMN username TEXT COLLATE NOCASE;
--> statement-breakpoint
CREATE UNIQUE INDEX profiles_username ON profiles(username) WHERE username IS NOT NULL;

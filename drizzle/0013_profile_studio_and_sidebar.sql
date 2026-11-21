ALTER TABLE profiles ADD COLUMN design_json TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN design_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE rooms ADD COLUMN sidebar_spacers_json TEXT NOT NULL DEFAULT '{}';

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function openLocalDatabase(filename) {
  const sqlite = new DatabaseSync(filename);
  const migrations = [
    ['rooms', '0000_rooms.sql'], ['channels', '0001_channels.sql'], ['profiles', '0002_profiles.sql'],
    ['profiles', '0003_room_and_profile_customization.sql', 'avatar_key'],
    ['message_reactions', '0004_chat_essentials.sql'],
    ['message_polls', '0005_images_polls_typing.sql'],
    ['voice_channels', '0006_voice.sql'],
    ['profiles', '0007_usernames.sql', 'username'],
    ['channel_settings', '0008_channel_tools.sql'],
    ['room_board_items', '0009_room_board.sql'],
    ['friendships', '0010_social.sql'],
    ['spotify_connections', '0011_spotify_listening.sql'],
    ['spotify_connections', '0012_spotify_oauth_verifier.sql', 'pending_verifier'],
  ];
  for (const [table, file, column] of migrations) {
    const applied = column ? sqlite.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column)
      : sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (applied) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  function prepare(sql, args = []) {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...next) => prepare(sql, next),
      first: async () => statement.get(...args) ?? null,
      run: async () => statement.run(...args),
      all: () => ({ results: statement.all(...args) }),
    };
  }

  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

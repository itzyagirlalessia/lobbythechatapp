# Changelog

Newest first. Each entry is tagged with who made it:

- **[itzyagirlalessia]**: changes made through ChatGPT/Codex
- **[Wilmer]**: changes made through Claude Code

Keep entries to one line. Add yours at the top of today's date (create the date heading if needed).

## 2026-11-21

- **[itzyagirlalessia]** Added local calendar date labels to room messages, DMs, and scheduled messages.
- **[itzyagirlalessia]** Added Lobby sign-out and guided ChatGPT account switching, with rooms and drafts saved separately by account.
- **[itzyagirlalessia]** Made Spotify sign-in and track requests compatible with Lobby’s hosting runtime.
- **[itzyagirlalessia]** Fixed the Spotify sign-in return flow when browsers omit the connection cookie, and showed specific errors when Spotify denies access.
- **[itzyagirlalessia]** Added a Spotify listening card to room profiles, with shared tracks and optional live playback progress.

## 2026-11-18

- **[Wilmer]** Split the 2,700-line `app.js` into 12 feature modules (see the code map in `AGENTS.md`); no behaviour changes.
- **[Wilmer]** Faster loading and lighter polling: Pluma image 1.36 MB → 0.37 MB, unchanged files are no longer re-downloaded, fewer database calls per room refresh, and duplicate device sessions no longer count toward the 100-person room limit.
- **[Wilmer]** Fixed joined rooms disappearing in new sessions: signed-in accounts now get their rooms back automatically, without the invite link.
- **[Wilmer]** Fewer GitHub Actions runs: removed the notify workflow (Claude posts the comment itself) and stopped double checks on pull request branches.
- **[Wilmer]** Pull requests now get an automatic comment tagging itzyagirlalessia with the changes on every push and merge.
- **[itzyagirlalessia]** Renamed the app Lobby, created Pluma the purple moth mascot, and updated the app branding, Terms and Copyright pages.
- **[Wilmer]** Added this changelog.
- **[itzyagirlalessia]** Added a safe GitHub pull helper and shared Codex/Claude collaboration rules (`AGENTS.md`, `CLAUDE.md`).
- **[itzyagirlalessia]** People list now shows one entry per account; workspace updates stay synced to GitHub.
- **[itzyagirlalessia]** Uploaded the full app source, database migrations and automated checks.
- **[itzyagirlalessia]** Documented the app source and hosting requirements.

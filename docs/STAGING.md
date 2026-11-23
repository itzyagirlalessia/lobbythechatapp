# Test and release Lobby updates

| Environment | GitHub branch | Site |
| --- | --- | --- |
| Staging | `staging` | [Lobby Staging](https://lobby-staging.itzyagirlalessia.chatgpt.site) |
| Production | `main` | [Lobby](https://duo-chat-workspace.itzyagirlalessia.chatgpt.site) |

## Publish a test build

1. Branch from the latest `staging`, make the change, and open a pull request into `staging`.
2. After the checks pass, merge it into `staging`. In Codex, ask **“Pull the staging branch and publish Lobby Staging.”**
3. Sign into the staging URL with an invited account. The **Staging** label appears in the app header. Set up a test profile and room there. Staging starts with its own profiles, messages, and uploads.

Codex uses the dedicated `lobby-staging` Sites checkout. In that checkout, `node scripts/pull-github.mjs --check` previews GitHub changes and `--apply` imports them. The local `.openai/github-sync.json` selects `staging`. The local hosting manifest selects the separate Lobby Staging project, with its own D1 database and R2 bucket. The Sites workflow builds, applies migrations, and publishes there. Keep hosting files and runtime secrets out of GitHub.

## Release a tested build

Open a pull request from the tested `staging` commit into `main`. Check the exact commit being promoted if staging has advanced since testing. After approval, merge the release with a merge commit, then ask Codex to pull `main` and publish production from the `duo-chat` Sites checkout. Review pending database migrations before the production deploy.

## Staging integrations

Staging has its own `ROOM_KEY_ENCRYPTION` secret and uses `DUO_ENVIRONMENT=staging` for its label. Provider connections are optional. To enable live Spotify on staging, first register `https://lobby-staging.itzyagirlalessia.chatgpt.site/api/profile/spotify/callback` in the Spotify app, then set the staging Site's `DUO_SPOTIFY_CLIENT_ID` and `DUO_SPOTIFY_REDIRECT_URI` and publish again.

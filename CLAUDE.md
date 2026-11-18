# Claude Code instructions

This project is developed by two people: one works through ChatGPT/Codex, the other through Claude Code.

Read and follow `AGENTS.md` first; it holds the shared project rules.

Claude-specific additions:

- Never push directly to `main`. Work in a feature branch and open a pull request for review.
- The live app is published from the ChatGPT/Sites workspace, not from GitHub. Merging a pull request does not deploy anything by itself.
- Run `node scripts/verify.mjs` before opening a pull request that changes chat behavior, and check the syntax of every modified JavaScript file with `node --check`.
- Never commit secrets, `.env` files, databases, user uploads, `dist/`, `.local/` or `.openai/`.

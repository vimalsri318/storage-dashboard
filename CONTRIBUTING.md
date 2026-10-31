# Contributing

Thanks for helping! Storage is small on purpose: **zero runtime dependencies**, no build step for the UI, and a safety-first approach to deleting files.

## Getting started
```bash
git clone https://github.com/vimalsri318/storage-dashboard && cd storage-dashboard
node server.js --open            # http://127.0.0.1:4747  (Node 18.15+)
npm test                         # node:test, no dependencies (admin tests need Node 22.13+)
./macos/build.sh                 # optional: native app + widget (Command Line Tools only)
```
Use `PORT=4748 STORAGE_DATA=/tmp/sd node server.js` to run a second instance with throw-away data.

## Ground rules
1. **Never delete anything without the user's confirmation.** Any new cleanup rule must (a) say why it is safe or what the user risks, (b) say how to get it back, and (c) go through `/api/clean` (ids produced by the scanner), never an arbitrary path from the browser.
2. **Be careful with paths.** Everything must stay inside `$HOME`; extend the protected list rather than loosening it.
3. **No new runtime dependencies** without a very good reason. Prefer the platform (Node built-ins, system tools).
4. **Privacy:** don't add anything to the telemetry payload. If you must, document it in `PRIVACY.md` and keep it opt-in.
5. Use `textContent`/`h()` for DOM — file names are untrusted.

## Pull requests
- Small, focused commits with a clear message (`feat(scope): …`, `fix(scope): …`, `docs: …`).
- Add or update tests for server/admin logic (`test/`).
- Update `CHANGELOG.md` under *Unreleased*.
- UI changes: include before/after screenshots in light **and** dark mode.

## Releasing (maintainers)
1. Bump `version` in `package.json`, update `CHANGELOG.md`, commit.
2. `git tag v1.2.3 && git push --tags` — the **Release** workflow builds the app, creates the GitHub release with the zip + SHA-256, and (if configured) tells your Fleet Admin server so installed apps get the update notice.

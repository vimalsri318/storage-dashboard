# Security policy

## Reporting a vulnerability
Please **do not open a public issue**. Use GitHub's private reporting: *Security → Report a vulnerability* on this repository. Include steps to reproduce and the impact. You'll get an acknowledgement within a few days.

## What matters most here
Storage deletes files, so we treat these as security bugs:
- any way to make the app delete or move something the user did not confirm, or outside `$HOME`;
- any way for a web page or another local process to call the write APIs (token, Host-header and path checks);
- bypassing update verification (HTTPS host allow-list, SHA-256, bundle id, code signature);
- Fleet Admin: authentication/session/CSRF flaws, injection, or collecting more than the documented telemetry.

## Supported versions
The latest release. Older versions receive fixes only through a new release.

## Hardening already in place
Local-only server (`127.0.0.1`, Host validation), per-run token on writes, server-side path validation and protected locations, Trash via Finder, fixed command allow-list, update downloads verified by SHA-256 + signature, admin passwords hashed with scrypt, HttpOnly/SameSite sessions, CSRF tokens, rate limits, CSP and an audit log. See [docs/architecture.md](docs/architecture.md) and [docs/fleet.md](docs/fleet.md).

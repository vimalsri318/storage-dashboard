# Changelog
All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0]
### Added
- Scanner, Overview, Checklist, Cleanup, Explorer and History pages; light/dark/auto themes.
- Checklist of small tasks (select → confirm → run) with command-only jobs (conda, Homebrew, Trash).
- Scan animation, launch splash and scan-complete animation.
- Native `Storage.app` (window + menu-bar item + widget), built with only the Command Line Tools.
- Opt-in telemetry and verified in-app updates ("restart to update").
- Optional Fleet Admin server: devices, releases with staged rollout, notices, adoption log, audit log.
- New logo and brand assets.
### Fixed
- Ticking a checklist circle no longer runs the task; it only selects it, and a confirmation is always shown.

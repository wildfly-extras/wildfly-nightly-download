# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GitHub Action (`wildfly-extras/wildfly-nightly-download`) that downloads the latest nightly SNAPSHOT
build of WildFly's Maven repository from WildFly's CI server, extracts it into `~/.m2/repository`, and
outputs the resolved WildFly version as `wildfly-version`. Used by downstream WildFly/EAP projects to
build/test against nightly snapshots.

All logic lives in `src/index.js` (a single script, ESM, no build-time bundler dependencies at dev time).
`action.yml` declares the single `uri` input (defaulting to the WildFly CI nightly repo URL) and the
`wildfly-version` output, and points `runs.main` at `dist/index.js`.

## Build / release model

This is a compiled GitHub Action: `dist/index.js` is a committed, `ncc`-bundled artifact that GitHub
Actions actually executes — it is NOT generated at Action run time. Any change to `src/index.js` requires
rebuilding `dist/` before it takes effect for consumers.

- `npm run build` — formats `src/*.{js,yml,yaml}` with Prettier, then bundles `src/index.js` into
  `dist/index.js` via `ncc` (minified, single file).
- `npm run format:check` / `npm run format:write` — Prettier only, config in `.prettierrc.cjs`.
- There is no real test suite (`npm test` is a placeholder that exits 1).

Release process (per README.adoc): build, commit the resulting `dist/` changes, tag the release, then bump
`version` in `package.json`.

## Key behavior notes

- Download and extraction are async but not awaited at the top level in `src/index.js` — the top-level
  `try/catch` only catches synchronous errors from directory setup; failures inside `download`/`extract`
  callbacks call `core.setFailed` indirectly via thrown errors inside async callbacks, so error propagation
  here is easy to break if refactoring.
- The tarball is expected to contain a nested tar (`extract` is called twice: once on the downloaded
  `.tar.gz`, once on the resulting inner tar) plus a `version.txt` at the extraction target root — that
  file's contents become the `wildfly-version` output.
- Target extraction directory is always `~/.m2/repository`; the downloaded repo is expected to only
  contain `org/wildfly/**/*SNAPSHOT*` paths.
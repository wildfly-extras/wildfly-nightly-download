# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this is

A GitHub Action (`wildfly-extras/wildfly-nightly-download`) that downloads the latest nightly SNAPSHOT
build of WildFly's Maven repository from WildFly's CI server, extracts it into `~/.m2/repository`, and
outputs the resolved WildFly version as `wildfly-version`. Used by downstream WildFly/EAP projects to
build/test against nightly snapshots.

The logic lives in `src/main.js` (ESM, no build-time bundler dependencies at dev time), which exports
`run()` and the helpers it is built from but has no side effects on import. `src/index.js` is a two-line
entry point that imports `run()` and awaits it; it exists so the module can be imported by tests without
executing the Action. `action.yml` declares the `uri` input (defaulting to the WildFly CI nightly repo
URL) and the optional `path` input, declares the `wildfly-version` output, and points `runs.main` at
`dist/index.js`.

## Build / release model

This is a compiled GitHub Action: `dist/index.js` is a committed, `ncc`-bundled artifact that GitHub
Actions actually executes — it is NOT generated at Action run time. Any change under `src/` requires
rebuilding `dist/` before it takes effect for consumers.

- `npm run build` — formats with Prettier, then bundles `src/index.js` into `dist/index.js` via `ncc`
  (minified, single file). `ncc` always names its output `index.js` regardless of the entry file, which
  is why `action.yml` can keep pointing at `dist/index.js`.
- `npm run format:check` / `npm run format:write` — Prettier only, config in `.prettierrc.cjs`.
- `npm test` — the `node:test` suite in `test/`, run with `node --test`. No test framework dependency.
- `npm run verify:dist` — rebuilds `dist/` and fails if the result differs from what is committed.
- `npm run run:local` — runs the Action from source against the real nightly URL, extracting into a
  throwaway `mktemp -d` directory. Override either with `INPUT_URI=... INPUT_PATH=... npm run run:local`.
  POSIX shells only, and note the download is several hundred MB.

`.github/workflows/ci.yml` runs `format:check`, `npm test` and `verify:dist` on pull requests and on
pushes to `main`. `.github/workflows/release.yml` is a `workflow_dispatch` that builds, tags the release
and opens a follow-up PR bumping `version` in `package.json`.

## Key behavior notes

- `download()` returns a promise and is awaited by `run()`. It rejects — rather than throwing from an
  event callback — on a non-200 status, an unexpected content type, a request error, and a write-stream
  error, deleting the partial file on each of those paths. Keep it that way: an error thrown from an
  emitter callback escapes the `try/catch` in `run()` and kills the job instead of calling
  `core.setFailed`.
- The tarball is expected to contain a nested tar of the same name (`extract` is called twice: once on
  the downloaded `.tar.gz`, once on the inner one) plus a `version.txt` at the extraction target root —
  that file's contents become the `wildfly-version` output. Both the downloaded archive and the nested
  one extracted into the target are deleted afterwards.
- `run()` deletes any leftover archive in the temp directory before downloading, because a file surviving
  from an earlier run is by definition one a failed run left behind and may be truncated.
- `download()` and `extractDownload()` take an optional archive path so tests can use a temp directory
  instead of the shared default.
- The extraction directory defaults to `~/.m2/repository` but is overridable with the `path` input; the
  downloaded repo is expected to only contain `org/wildfly/**/*SNAPSHOT*` paths.

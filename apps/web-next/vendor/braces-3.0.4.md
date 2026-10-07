# braces 3.0.4 local patch

`vendor/braces-3.0.4.tgz` is braces 3.0.3 plus a nesting-depth guard. The package version inside the tarball is 3.0.4. It is not an npmjs release. npm still has no braces release past 3.0.3.

## Advisory

GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 affects braces <= 3.0.3. A deeply nested brace pattern can make the parser recurse without a depth limit. The vendored copy throws `RangeError` once nesting passes 64 (the default `maxDepth`). Callers can raise or disable that limit with `options.maxDepth`.

SHA-1 of the committed tarball: `02dd6f35f706c29db1b5f3746ea3ca75835deda7`.

## Why it is in this app

This app does not import braces. The package is pulled in for lint only:

`@next/eslint-plugin-next` -> `fast-glob` 3.3.1 -> `micromatch` 4.0.8 -> `braces`.

`package.json` overrides `braces` to `file:vendor/braces-3.0.4.tgz` and also lists that same file spec as a direct dependency. The direct dependency is required so `npm ci` resolves the tarball from this package root. An override alone is resolved from inside `micromatch`, which cannot see `vendor/`. `Dockerfile.web` copies the tarball before `npm ci` for the same reason.

## When to delete this

Delete the tarball, this note, the direct dependency, and the `braces` override when upstream publishes a fixed release. Do not keep the file spec after that.

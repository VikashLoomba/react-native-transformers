# npm publishing

This document covers npm publishing setup and release automation for `@automatalabs/react-native-transformers`.

## One-time npm trusted publisher setup

1. Create the npm package:
   - `@automatalabs/react-native-transformers`
2. In npm, open the package settings and add a **Trusted Publisher**.
3. Use these values:
   - **Provider**: GitHub Actions
   - **Repository owner**: `VikashLoomba`
   - **Repository name**: `react-native-transformers`
   - **Workflow filename**: `publish.yml`
   - **Environment name**: leave empty unless you later add one to the workflow
4. Save the trusted publisher.

> The GitHub repo lives under the personal account, while the npm package is published under the `@automatalabs` npm scope.

## Release workflows

`.github/workflows/publish.yml` handles three release paths:

1. **Tag release**: push a `v*` tag to publish the version already present in `package.json`
2. **Manual publish**: run the workflow from GitHub Actions with `mode=publish`
3. **Automated Transformers.js tracking**: the scheduled run, or a manual run with `mode=track-transformers`, compares the pinned `@huggingface/transformers` version in `package.json` against the latest npm release and, when needed:
   - updates the root peer dependency and `example/package.json`
   - bumps this package's patch version
   - refreshes `package-lock.json` and `example/package-lock.json`
   - validates the package
   - commits the change, publishes to npm, and pushes a matching `v*` tag

If the peer dependency is already up to date but the current package version has not been published yet, the tracking mode republishes that current version and ensures the matching git tag exists. This lets the automation recover cleanly from a failed publish after the version-bump commit was already pushed.

## Manual tag release flow

1. Make sure `package.json` has the version you want to publish.
2. Commit your changes.
3. Tag the commit with the same version prefixed by `v`.

```sh
git tag v0.1.0
git push origin HEAD --tags
```

4. GitHub Actions runs `.github/workflows/publish.yml`.
5. The workflow publishes the package with npm provenance enabled.

## Manual workflow-dispatch release flow

From the GitHub Actions UI, run **Publish package** and choose one of these modes:

- `publish`: publish the current checked-in version
- `track-transformers`: sync to the latest published `@huggingface/transformers` version and publish a new wrapper release if needed

## Pre-publish checklist

- `npm run check`
- `npm pack --dry-run`
- confirm the package contents are only the files you intend to publish
- confirm `README.md`, `LICENSE`, `package.json`, and exports are correct
- confirm the git tag matches `package.json` version when doing a tag-based release

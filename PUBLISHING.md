# Publishing

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

## Release flow

1. Make sure `package.json` has the version you want to publish.
2. Commit your changes.
3. Tag the commit with the same version prefixed by `v`.

```sh
git tag v0.1.0
git push origin HEAD --tags
```

4. GitHub Actions runs `.github/workflows/publish.yml`.
5. The workflow publishes the package with npm provenance enabled.

## Manual publish from GitHub Actions

You can also trigger the `Publish package` workflow manually from the GitHub Actions UI using **Run workflow**.

## Pre-publish checklist

- `npm run check`
- `npm pack --dry-run`
- confirm the package contents are only the files you intend to publish
- confirm `README.md`, `LICENSE`, `package.json`, and exports are correct
- confirm the git tag matches `package.json` version

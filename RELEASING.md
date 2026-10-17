# Releasing Makio MeshLine

This checklist is for maintainers preparing a tagged npm release. Version 2 keeps the ordinary `MeshLine` facade as the supported entry point; `makio-meshline/gpu-path` and the compute/simplification labs remain experimental unless their documentation says otherwise.

## 1. Prepare the release branch

1. Merge the intended changes into `main` and start from a clean checkout.
2. Move the relevant `CHANGELOG.md` section from “unreleased” to the exact version and release date.
3. Confirm the stable/experimental labels in the README and documentation match the package being published.
4. Choose the version and npm dist-tag:
   - Stable: `2.0.0` with `latest`.
   - Prerelease: for example `2.0.0-rc.1` with `next`.

Before the first automated publish, configure npm trusted publishing for the `makio-meshline` package with repository `Makio64/makio-meshline` and workflow filename `publish.yml`. The workflow uses GitHub OIDC and does not require a long-lived npm token.

Do not manually create the tag or publish from a workstation. The release workflow owns the version commit, tag, provenance-enabled npm publish, and GitHub release. It rejects invalid or backwards-moving versions, prereleases assigned to `latest`, version-like dist-tags, existing tags, and unfinished changelog headings.

## 2. Run the release gate

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

The gate runs lint, all runtime and declaration tests, the demo and documentation builds, every standalone example build against the workspace package, and npm-tarball inspection. It extracts the real tarball, imports public entry points through package specifiers, and rejects workspace files or operating-system metadata.

`pnpm verify:compat` then installs that tarball in isolated consumers and checks this required Three.js matrix:

| Profile | Three.js | Coverage |
|---|---:|---|
| Minimum core | r180.0 | Root runtime and declarations; core node-level shader tests |
| Minimum optional entries | r183.0 | Root, `gpu-culling`, and `gpu-path` runtime and declarations; every node-level shader test |
| Pinned current | Workspace manifest | Root and optional-entry runtime and declarations; every node-level shader test |

The node-level shader tests are the `test/*.test.js` files that build shaders through `test/helpers/shaderBuilder.js`. Node-builder output changes between Three.js releases (r180, for example, still discards zero-alpha fragments in blended node materials without an alpha test), so each profile runs them against its own `three`: the gate copies `src/`, `test/`, and the demo and documentation modules those tests import below the profile's consumer, without the repository's `node_modules`. Tests of the optional entries, listed in `optionalEntryShaderTests` in `scripts/verify-compatibility.mjs`, skip the minimum core profile. `pnpm verify:compat --list` prints the files each profile runs.

The minimum versions live in `package.json#meshlineCompatibility`; the pinned-current row comes from the exact root `three` and `@types/three` development dependencies. CI also runs `pnpm verify:compat:canary` against the moving Three.js `dev` branch with `continue-on-error`. That canary is deliberately excluded from `release:check`, so upstream development changes are visible without making the release gate non-reproducible.

For a human-readable tarball inventory:

```bash
cd src
npm pack --dry-run
```

Before a major performance release, also capture the three machine-local benchmark reports and compare them with the previous candidate. They are diagnostic measurements rather than fixed CI thresholds:

```bash
pnpm bench:v2
pnpm bench:hotpaths
pnpm bench:surface-topology
```

## 3. Dispatch the release

From the GitHub Actions “Create release” workflow on `main`, enter the exact version and optional npm tag. The workflow:

1. Rejects invalid, existing, or already-published versions.
2. Runs the full release gate.
3. Updates `src/package.json` when necessary and commits the version bump.
4. Creates and pushes the version tag.
5. Dispatches the tag-scoped publish workflow.
6. Re-runs the release gate from the tag, publishes with npm provenance, creates the GitHub release, and waits for that workflow to finish.

If the version commit and tag exist but publishing fails, fix the publish prerequisite and rerun “Publish to npm” from that exact tag, version, and dist-tag. The workflow is idempotent when the registry version already exists under the requested tag. Do not rerun “Create release” for an existing tag.

## 4. Verify the public release

```bash
npm view makio-meshline@2.0.0 version dist-tags --json
```

Then install the released version in a clean temporary project and verify the three public entry points:

```js
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
```

Check the hosted documentation, Basic demo, Surface demo, framework starters, and the generated GitHub release notes. If a release defect is found, prefer a corrective patch or npm deprecation notice over unpublishing an immutable version.

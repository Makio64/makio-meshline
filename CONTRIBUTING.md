## Contributing to Makio MeshLine

Thanks for your interest in contributing!

### Setup
- Use pnpm v10+.
- Workspace packages: `src` (library), `demo` (examples), `docs` (vitepress).
- Install: `pnpm i`
- Run demo: `pnpm dev`
- Run docs: `pnpm docs:dev`

### Development
- Code style: follow existing formatting; run `pnpm lint` and `pnpm lint:fix`.
- Prefer ESM and explicit named exports.
- Avoid breaking API changes without discussion in an issue first.

### Pull Requests
- Open an issue first for features/large changes.
- Add tests or demo entries where applicable.
- Update docs where relevant.
- CI should be green.

### Commit & Release
- Conventional commits are appreciated.
- Releases are cut from the GitHub Actions `Create release` workflow.
- The release workflow updates `src/package.json`, tags `main`, dispatches `publish.yml`, publishes to npm with trusted publishing, and creates GitHub release notes.
- Stable releases should use the default npm tag `latest`. Pre-releases should use a version like `1.3.0-beta.1` and normally publish under the npm tag `next`.
- `CHANGELOG.md` remains manual. Update it in the same PR when you want an in-repo changelog entry.

### License
By contributing, you agree that your contributions will be licensed under the MIT License.



# QueueFlux releases and versioning

## Automatic semantic versioning

QueueFlux uses [Release Please](https://github.com/googleapis/release-please) with Conventional Commits. The root Maven parent POM is the canonical project version. Release Please updates it and keeps all four child-module parent versions synchronized.

Use Conventional Commit prefixes on commits or PR titles:

| Commit type | Version bump |
|---|---|
| `fix:` | Patch (e.g. 0.1.0 → 0.1.1) |
| `feat:` | Minor (e.g. 0.1.0 → 0.2.0) |
| `feat!:` or a `BREAKING CHANGE:` footer | Major (1.0.0 → 2.0.0); before 1.0, breaking changes follow pre-1.0 SemVer behavior |
| `docs:`, `test:`, `chore:`, `ci:`, `refactor:` | No release by themselves |

For 0.x releases, feature commits bump the minor version and fixes bump the patch version.

## Release flow

1. Changes merge into `main` using Conventional Commit-compatible PR titles.
2. Release Please automatically opens or updates a **Release PR** with the version bump and changelog. No one manually edits the release version.
3. Review and merge that Release PR (this is the deliberate approval gate).
4. Release Please creates the matching tag and GitHub Release automatically.
5. The same workflow builds/tests the backend and frontend and attaches the executable API JAR, Maven-module ZIP, and frontend ZIP. Releases below 1.0.0 are marked prerelease.

## Initial release bootstrap

The initial manifest is set to `0.0.0` so Release Please can propose the first release from the project's Conventional Commits. The first release should be `0.1.0` (or a version determined from the commit history).

## Permissions

The workflow uses the repository's `GITHUB_TOKEN` with `contents: write` and `pull-requests: write`. In GitHub repository settings, ensure **Settings → Actions → General → Workflow permissions** allows GitHub Actions to create pull requests. If this setting is disabled, Release Please cannot open its release PR.

## Conventional Commit examples

- `feat: add worker scaling scenarios`
- `fix: correct retry backoff calculation`
- `feat(api)!: change simulation result schema`
- `docs: explain virtual time`

See [Conventional Commits](https://www.conventionalcommits.org/) and the [Release Please docs](https://github.com/googleapis/release-please).

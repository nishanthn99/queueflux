# QueueFlux releases and versioning

## Single source of truth

The root Maven parent POM, `pom.xml`, is the canonical version source for the entire backend reactor. Keep the four child module parent-version declarations aligned with it:

- `backend/queue-model/pom.xml`
- `backend/simulation-engine/pom.xml`
- `backend/simulation-profiles/pom.xml`
- `backend/server/pom.xml`

The current planned release is **0.1.0**. Do not maintain a separate version file that can drift from the Maven parent.

## Automatic GitHub Release

The `Create GitHub Release` workflow runs when a versioned POM change reaches `main`, or when manually dispatched. It:

1. Reads the version from the root parent POM.
2. Rejects empty, malformed, or `-SNAPSHOT` versions.
3. Skips safely if that tag/release already exists.
4. Runs `mvn clean verify` and the frontend production build.
5. Attaches the executable API JAR, a ZIP of Maven module JARs, and a ZIP of the frontend production bundle.
6. Creates a GitHub Release with auto-generated release notes and tag `v<version>`.

Versions below 1.0.0 are marked as prereleases to signal that the API and simulation semantics may still evolve.

## Release process for future versions

For a new release, update the root POM and every child module's parent version in a reviewed PR. Use a stable Maven version (for example `0.1.1`), merge it to `main`, and the release workflow will create `v0.1.1`. Do not reuse a released version or overwrite an existing tag.

The published GitHub Release triggers the separate `Publish Maven artifacts` workflow, which publishes the Maven reactor to GitHub Packages.

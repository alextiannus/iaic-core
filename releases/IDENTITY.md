# Candidate package identity

Starting with candidate.93, the package's SemVer prerelease, GitHub tag and npm-generated tarball filename agree:

```text
package version: 0.1.0-candidate.93
release tag:    v0.1.0-candidate.93
archive:        immedi-iaic-core-0.1.0-candidate.93.tgz
```

Download the release asset to its version-qualified filename, verify its published SHA-256, then install that path with ordinary `npm install`. Do not overwrite an older candidate's file path or rename new bytes to an old immutable release identity.

`iaic init` copies the supplied archive to `vendor/core-SHA256.tgz` and writes that exact dependency path. Changed bytes therefore have a different vendor path even if a caller used a generic download filename. The digest identifies copied bytes; it does not independently establish a trusted publisher.

Inspect the **installed** runtime from the consuming project:

```js
import {CORE_RELEASE} from '@immedi/iaic-core/releases/identity.js';
if (CORE_RELEASE.version !== '0.1.0-candidate.93') throw Error('Wrong installed Core');
```

The same frozen object is exported from the root. It reads the installed package metadata, rather than accepting an application-supplied label. It identifies a release version; it is not a cryptographic signature, commit identity or substitute for checking the archive hash. Public root TypeScript declarations are a separate pending feedback item; this subpath has its own declaration.

`npm run verify:release-upgrade` downloads the pinned, hash-verified real candidate.93 archive, installs it, and upgrades the same consumer to the current pack. Both installations use the same node_modules, lockfile and npm cache without `--force`, cache clearing or deletion between them. It checks the predecessor's installed identity, then verifies that the runtime identity changes and that installed metadata and lockfile match the new candidate. The normal package check still runs all examples independently.

For the next publication, increment package.json/package-lock.json together using `npm version NEW_PRERELEASE --no-git-tag-version --ignore-scripts`, retain immutable filenames, and update the predecessor fixture and expected metadata when advancing its baseline. Candidate.93 → .94 is the current gate transition; this is not evidence for unexecuted future upgrade pairs. Publish only the tested source under `v` + package version, verify the tag target and downloaded bytes, and record the replaced candidate's finite lifetime. Existing archives remain immutable.

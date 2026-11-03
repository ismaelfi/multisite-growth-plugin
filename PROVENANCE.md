# Provenance

The configuration, scanning, Search Console/Treg bridge, local project inspection and issue ledger were adapted from dsh-portfolio, the original user-owned local DSH prototype. Its package declares the MIT license. The DSH runtime host and browser client are not bundled or required.

The Codex MCP adapter, workflow, independent snapshot importer, evidence store and local dashboard are part of this project. Imported portfolios and account connections belong to each user and are not distributed with the source.

Runtime dependencies and their licenses are recorded in package.json and package-lock.json; install them with npm ci. No upstream DSH runtime code or private portfolio content is included in the release.

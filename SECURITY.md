# Security Policy

## System and Scope

Wuwa Map is a browser map application deployed as static assets under `/wuwa-map`. It stores profiles, map progress, settings, and imported map packs in IndexedDB, uses a service worker for offline caching, and can sync progress with the same-origin API. This policy covers the application, `src/`, `public/`, `server/`, `tools/`, and deployment workflows.

## Threat Model and Trust Boundaries

- Users control browser storage and may provide backup or map-pack JSON files.
- Catalog, map-pack, icon, image, and tile URLs cross a network boundary and must remain constrained to intended resource types and origins.
- The service worker and deployment workflow control which static assets are served and cached.
- CI deployment credentials and DirectAdmin API calls are privileged infrastructure boundaries.
- The optional sync API is responsible for profile isolation and authenticated progress access.

## Security Invariants

- Imported JSON is validated before use and rendered through text or DOM APIs without interpreting user content as HTML.
- External resource URLs are restricted by the map-pack parser; deployment verification must detect mixed app, catalog, and service-worker versions.
- Progress remains isolated by profile and progress map namespace. Catalog or marker identifier changes must not silently discard local progress.
- CI logs and client responses must not expose deployment credentials, session secrets, or private backup data.
- Static deployment and archive extraction must stay within the configured production directory.

## Reportable Findings and Severity Context

Report vulnerabilities that can cause cross-profile data access, loss or corruption of local progress, stored or reflected script execution, unsafe network resource loading, credential or session disclosure, deployment path traversal, archive overwrite outside the target directory, or a production deployment serving mismatched app and data assets. Severity depends on reachability and user impact; credential exposure, cross-profile access, and script execution are high priority.

## Out of Scope, Exclusions, and Accepted Risk

The application is intentionally local-first: users can modify their own IndexedDB state and imported data. Availability issues caused only by a user's browser, network, or third-party map asset host are out of scope unless they bypass an application security boundary. Content accuracy and copyright ownership of user-provided map data are not security findings.

## Known Limitations and Compensating Controls

The service worker caches same-origin static resources and map JSON for offline use. Production verification checks the deployed shell, hashed app asset, service-worker cache marker, catalog shape, representative map pack, and tile availability. Users should export backups before clearing browser storage or changing devices.

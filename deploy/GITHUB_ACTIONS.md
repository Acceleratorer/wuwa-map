# GitHub Actions deployment

The repository includes [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml).

Every pull request runs the full test and production build. A push to `main`,
or a manual `workflow_dispatch`, runs the same checks and then deploys the
generated `dist/` bundle to `/wuwa-map/` through the DirectAdmin API.

Create these repository secrets once:

| Secret | Value |
| --- | --- |
| `DIRECTADMIN_HOST` | DirectAdmin hostname, without `https://` or `:2222` |
| `DIRECTADMIN_USER` | DirectAdmin username |
| `DIRECTADMIN_PASSWORD` | DirectAdmin password |

The remote directory is:

```text
/domains/accel.io.vn/public_html/wuwa-map
```

The deploy uploads a compressed archive, extracts it with overwrite enabled,
normalizes directory permissions to `755`, and verifies the app shell, service
worker, catalog size, and a state 912 map tile. Credentials stay in GitHub
Actions secrets and are never committed to the repository.

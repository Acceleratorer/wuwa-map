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
| `DIRECTADMIN_CA_BUNDLE` | PEM bundle for the DirectAdmin TLS chain |

The remote directory is:

```text
/domains/accel.io.vn/public_html/wuwa-map
```

The deploy uploads an immutable SHA-named archive into a staging directory,
normalizes directory permissions to `755`, then swaps the staging directory
into `/wuwa-map/`. The previous production directory is retained in a hidden
rollback slot until the next successful deployment. Production verification
checks the app shell, hashed bundle, service worker, catalog, map pack, and a
state 912 map tile. If deployment or verification fails after the swap, the
workflow moves the failed release aside and restores the previous directory
automatically. Credentials and the DirectAdmin CA bundle stay in GitHub
Actions secrets and are never committed to the repository.

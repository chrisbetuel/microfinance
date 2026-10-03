# Deployment — lms.oweru.com

Live on the shared CloudPanel VPS `31.97.176.48` (same server as works.oweru.com
and the other Oweru sites). SSH as root with the `kkkt` alias.

| What | Where |
|---|---|
| CloudPanel site | `lms.oweru.com`, Python 3.12 site, site user `oweru-lms`, app port `8095` |
| Backend code | `/home/oweru-lms/app` (venv in `.venv`, settings in `.env` — not in git) |
| Frontend build | `/home/oweru-lms/htdocs/lms.oweru.com` (nginx serves files; everything else → app) |
| Database | SQLite `/home/oweru-lms/data/lms.db` |
| Backups | `/home/oweru-lms/backups/lms` — nightly, last 14 kept (`backup_db.py`) |
| Process | systemd `oweru-lms.service` (gunicorn on 127.0.0.1:8095, 3 workers) |
| Logs | `/home/oweru-lms/logs/` (gunicorn, cron) |
| Cron (site user) | 00:15 UTC `age_loans` (arrears + collection cases), 01:30 UTC database backup |

URL layout in production: the API is under `/api/…` (`LMS_API_PREFIX=api`), page
routes (`/`, `/borrowers`, `/portal`, …) get the React app (`LMS_SPA_DIR`).
Gateway callbacks therefore are `https://lms.oweru.com/api/sms/haflaway/webhook`
and `https://lms.oweru.com/api/payments/callback`.

## Update

```bash
bash deploy/deploy.sh
```

Backs up the database, uploads what is committed (`git archive`), rebuilds the
frontend, installs requirements, migrates, collects static files and restarts.

## Useful commands (on the server)

```bash
systemctl status oweru-lms          # is it running?
journalctl -u oweru-lms -n 50       # recent errors
cd /home/oweru-lms/app && sudo -u oweru-lms .venv/bin/python manage.py <command>
```

Change a staff password: sign in and use **My profile → Change password**, or
`manage.py changepassword` is not available (custom user model by email) — use
`manage.py shell` with `Staff.objects.get(email=…).set_password(…)`.

## SMS

`.env` on the server holds the Haflaway key. `LMS_SMS_ALLOWED_NUMBERS` keeps it in
test mode (only those numbers are texted) while the system holds demo data — remove
the line and restart the service when real borrowers are entered.

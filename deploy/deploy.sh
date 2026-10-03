#!/usr/bin/env bash
# Update deploy of the loan system to https://lms.oweru.com (CloudPanel VPS 31.97.176.48).
#
#   bash deploy/deploy.sh          # from the repo root, on a clean, pushed main
#
# Uses the "kkkt" SSH alias (~/.ssh/config). Ships exactly what is committed
# (git archive), so no GitHub token ever goes on the server. The server's
# backend .env, SQLite database (/home/oweru-lms/data) and backups are untouched.
#
# First-time setup (already done 2026-10-03) is described in deploy/README.md.
set -euo pipefail

TARGET="${LMS_SSH:-kkkt}"
SITE=/home/oweru-lms
APP=$SITE/app
WEB=$SITE/htdocs/lms.oweru.com

cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit or stash your changes first (the deploy ships what is committed)." >&2
  exit 1
fi
echo "==> deploying $(git log --oneline -1)"

echo "==> building the frontend (API at /api)"
rm -rf dist
VITE_API_BASE_URL=/api npx vite build >/dev/null

echo "==> backing up the database"
ssh "$TARGET" "sudo -u oweru-lms $APP/.venv/bin/python $APP/backup_db.py"

echo "==> uploading backend"
git archive --format=tar.gz HEAD:backend | ssh "$TARGET" "tar xzf - -C $APP"

echo "==> uploading frontend"
ssh "$TARGET" "find $WEB/assets -type f -delete 2>/dev/null || true"
tar czf - -C dist . | ssh "$TARGET" "tar xzf - -C $WEB"

echo "==> installing, migrating, restarting"
ssh "$TARGET" bash -s <<EOF
set -e
chown -R oweru-lms:oweru-lms $APP $WEB
cd $APP
sudo -u oweru-lms .venv/bin/pip install -q -r requirements.txt
sudo -u oweru-lms .venv/bin/python manage.py migrate --noinput
sudo -u oweru-lms .venv/bin/python manage.py collectstatic --noinput >/dev/null
systemctl restart oweru-lms.service
sleep 3
systemctl is-active oweru-lms.service
curl -sk --resolve lms.oweru.com:443:127.0.0.1 https://lms.oweru.com/api/health; echo
EOF
echo "==> done: https://lms.oweru.com"

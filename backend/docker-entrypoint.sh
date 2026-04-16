#!/bin/sh
set -e

echo "==> Waiting for database..."
until python -c "
import socket, os
host = 'db'
port = 5432
try:
    s = socket.create_connection((host, port), timeout=2)
    s.close()
    exit(0)
except Exception:
    exit(1)
" 2>/dev/null; do
  echo "    DB not ready, retrying in 2s..."
  sleep 2
done
echo "    DB is ready!"

echo "==> Running migrations..."
python manage.py migrate --noinput

echo "==> Collecting static files..."
python manage.py collectstatic --noinput --clear

echo "==> Starting Django..."
exec python manage.py runserver 0.0.0.0:8000
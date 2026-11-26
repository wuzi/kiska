#!/bin/sh
set -eu
cd /backup
sha256sum -c snapshot.sha256
if test -s objects.sha256; then sha256sum --quiet -c objects.sha256; fi
tables=$(psql -X -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
test "$tables" = 0 || { echo "Restore requires an empty database" >&2; exit 1; }
objects=$(aws --endpoint-url "$S3_ENDPOINT" s3api list-objects-v2 --bucket "$S3_BUCKET" --max-keys 1 --query KeyCount --output text)
test "$objects" = 0 || { echo "Restore requires an empty bucket" >&2; exit 1; }
aws --endpoint-url "$S3_ENDPOINT" s3 sync objects/ "s3://$S3_BUCKET/" --content-type image/webp --cache-control 'private, no-store' --only-show-errors
# Verify the bytes after the S3 round trip before opening the restored database.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/objects"
aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$S3_BUCKET/" "$tmp/objects" --only-show-errors
(cd "$tmp" && if test -s /backup/objects.sha256; then sha256sum --quiet -c /backup/objects.sha256; fi)
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" db.dump
psql -X -Aqt -F ' ' -c 'SELECT object_key, bytes FROM media WHERE ready ORDER BY object_key' > "$tmp/media.refs"
cmp media.refs "$tmp/media.refs"

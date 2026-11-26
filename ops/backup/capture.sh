#!/bin/sh
set -eu
umask 077
destination=/backup
test -d "$destination"
test -z "$(ls -A "$destination")" || { echo "Backup directory must be empty" >&2; exit 1; }
cd "$destination"
mkdir objects
pg_dump --format=custom --no-owner --no-privileges --file=db.dump
aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$S3_BUCKET/" objects/ --only-show-errors
# Every ready DB reference must have a matching object with the exact charged size.
psql -X -Aqt -F ' ' -c 'SELECT object_key, bytes FROM media WHERE ready ORDER BY object_key' > media.refs
while read -r object size; do
    test -f "objects/$object" && test "$(wc -c <"objects/$object")" -eq "$size" || { echo "Missing or incomplete object $object" >&2; exit 1; }
done < media.refs
find objects -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > objects.sha256
sha256sum db.dump media.refs objects.sha256 > snapshot.sha256

#!/bin/sh
set -e

echo 'Waiting for Orthanc...'
until curl -sf -u admin:orthanc http://orthanc:8042/system > /dev/null; do
  echo 'Not ready, retrying in 3s...'
  sleep 3
done

echo 'Orthanc ready. Scanning for DICOM files...'

UPLOADED=0
FAILED=0

for f in $(find /dicom_files -type f -name "*.dcm" -o -type f -name "*.DCM"); do
  if [ -z "$f" ] || [ ! -f "$f" ]; then
    continue
  fi
  echo "Uploading: $f"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -u admin:orthanc \
    -X POST http://orthanc:8042/instances \
    -H "Content-Type: application/dicom" \
    --data-binary @"$f")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "OK ($HTTP_CODE): $f"
    UPLOADED=$((UPLOADED + 1))
  else
    echo "FAILED (HTTP $HTTP_CODE): $f"
    FAILED=$((FAILED + 1))
  fi
done

echo "Done. Uploaded: $UPLOADED, Failed: $FAILED"
#!/bin/sh
# Build UkrainianL10n.spk from this dir.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
OUT="UkrainianL10n.spk"
rm -f package.tgz "$OUT"
# 1) package.tgz = gzipped tar of pkgroot contents (./ui ./bin ...)
tar czf package.tgz -C pkgroot --owner=0 --group=0 .
# 2) the SPK = plain tar of the package layout
tar cf "$OUT" --owner=0 --group=0 \
    INFO package.tgz scripts conf PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG
ls -l "$OUT"
echo "=== spk contents ==="
tar tf "$OUT"

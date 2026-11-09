#!/usr/bin/env bash
# Build the api and web images natively and push them to GHCR.
#
# Run this on the deploy host (Oracle Ampere, aarch64). Building the same arch
# natively avoids QEMU emulation, which made CI release jobs hang for 10+
# minutes per tag. After it succeeds, push the tag and the Release workflow will
# verify the images exist and publish the GitHub release entry.
#
# Usage: scripts/publish-images.sh 0.1.34 [--no-push]
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> [--no-push]" >&2
  exit 2
fi
PUSH="${2:-}"
REGISTRY="${REGISTRY:-ghcr.io/fallforest}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> architecture: $(uname -m)"
# image name -> source app directory
for pair in api:server web:web; do
  component="${pair%%:*}"
  app="${pair##*:}"
  image="$REGISTRY/marvelous-docs-$component:$VERSION"
  echo "==> building $image from apps/$app"
  docker build \
    --platform "linux/$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')" \
    -f "apps/$app/Dockerfile" \
    -t "$image" \
    -t "$REGISTRY/marvelous-docs-$component:latest" \
    .
  if [ "$PUSH" != "--no-push" ]; then
    echo "==> pushing $image"
    docker push "$image"
    docker push "$REGISTRY/marvelous-docs-$component:latest"
  fi
done

echo "==> done: $VERSION"
echo "Next: git tag -a v$VERSION -m 'Marvelous Docs $VERSION' && push the tag."

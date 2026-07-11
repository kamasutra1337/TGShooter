#!/usr/bin/env bash
# Deploy the built client to GitHub Pages (gh-pages branch) — the Telegram Mini
# App host. Run from the repo root: bash scripts/deploy-pages.sh
set -euo pipefail

REPO="https://github.com/kamasutra1337/TGShooter.git"

npm run build
cd dist
touch .nojekyll                 # skip Jekyll processing
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="tigicoder" -c user.email="hauntedtigi@gmail.com" \
    commit -q -m "Deploy TG Shooter Mini App"
git push -f "$REPO" gh-pages
cd ..
rm -rf dist/.git
echo "Deployed → https://kamasutra1337.github.io/TGShooter/"

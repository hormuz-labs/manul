#!/bin/sh
# Build (or update) Manul's signed apt repository from .deb files. Runs in CI on Ubuntu (needs apt-utils + gpg).
#   scripts/apt-repo.sh <dir with .deb files> <repo dir> <gpg key id>
# Layout: pool/main/m/manul/*.deb, dists/stable/main/binary-{amd64,arm64}/Packages(.gz), dists/stable/{Release,InRelease,Release.gpg}
# Users:
#   curl -fsSL https://apt.manul.app/manul.gpg | sudo gpg --dearmor -o /usr/share/keyrings/manul.gpg
#   echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.app stable main" | sudo tee /etc/apt/sources.list.d/manul.list
#   sudo apt update && sudo apt install manul
set -eu
DEBS=$1
REPO=$2
KEY=$3
mkdir -p "$REPO/pool/main/m/manul"
cp "$DEBS"/*.deb "$REPO/pool/main/m/manul/"
cd "$REPO"
for arch in amd64 arm64; do
  mkdir -p "dists/stable/main/binary-$arch"
  apt-ftparchive --arch "$arch" packages pool > "dists/stable/main/binary-$arch/Packages"
  gzip -9fk "dists/stable/main/binary-$arch/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="Hormuz Labs" \
  -o APT::FTPArchive::Release::Label="Manul" \
  -o APT::FTPArchive::Release::Suite="stable" \
  -o APT::FTPArchive::Release::Codename="stable" \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components="main" \
  release dists/stable > dists/stable/Release
gpg --batch --yes --default-key "$KEY" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --default-key "$KEY" -abs -o dists/stable/Release.gpg dists/stable/Release
gpg --batch --yes --armor --export "$KEY" > manul.gpg
echo "apt repository ready in $REPO"

set -eu
release=/opt/finance-academy/releases/20261016-4
test ! -e "$release"
mkdir "$release"
tar -xzf /root/finance-academy-secure.tar.gz -C "$release"
chown -R finacademy:finacademy "$release"
cd "$release"
sudo -u finacademy npm ci --omit=dev --ignore-scripts --no-fund --no-audit

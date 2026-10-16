set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nodejs npm postgresql postgresql-contrib nginx certbot python3-certbot-nginx ufw
id finacademy >/dev/null 2>&1 || useradd --system --home /var/lib/finance-academy --create-home --shell /usr/sbin/nologin finacademy
install -d -o finacademy -g finacademy -m 750 /opt/finance-academy/releases /var/lib/finance-academy /var/backups/finance-academy
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='finacademy'" | grep -q 1 || sudo -u postgres createuser finacademy
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='finacademy'" | grep -q 1 || sudo -u postgres createdb -O finacademy finacademy
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
node --version
psql --version
nginx -v

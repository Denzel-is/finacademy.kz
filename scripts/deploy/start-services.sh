set -eu
install -d -o root -g root -m 755 /var/www/finance-academy
cp -a /opt/finance-academy/current/dist/. /var/www/finance-academy/
find /var/www/finance-academy -type d -exec chmod 755 {} +
find /var/www/finance-academy -type f -exec chmod 644 {} +
cat >/etc/systemd/system/finance-academy.service <<'UNIT'
[Unit]
Description=FinanceAcademy API
After=network.target postgresql.service
Requires=postgresql.service
[Service]
Type=simple
User=finacademy
Group=finacademy
WorkingDirectory=/opt/finance-academy/current
Environment=NODE_ENV=production
Environment=PUBLIC_ORIGIN=https://finacademy.kz
ExecStart=/usr/bin/node /opt/finance-academy/current/build/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/finance-academy
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/nginx/sites-available/finance-academy <<'NGINX'
server {
    listen 80;
    server_name finacademy.kz www.finacademy.kz;
    root /var/www/finance-academy;
    index index.html;
    client_max_body_size 1m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy same-origin always;
    gzip on;
    gzip_types application/javascript application/json text/css;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        proxy_hide_header X-Worker-Colo;
    }
    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
    location / { try_files $uri $uri/ /index.html; }
    location ~ /\. { deny all; }
}
NGINX
ln -sfn /etc/nginx/sites-available/finance-academy /etc/nginx/sites-enabled/finance-academy
systemctl daemon-reload
systemctl enable --now finance-academy
nginx -t
systemctl reload nginx
sleep 2
curl --fail --silent http://127.0.0.1:3000/api/health

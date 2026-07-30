# Deploy lên VPS tại accel.io.vn/wuwa-map/

Đây là cấu hình tham khảo cho VPS Linux dùng systemd + Nginx. Backend và frontend
được phục vụ bởi cùng một Node process tại `127.0.0.1:8787`; Nginx chỉ public
đường dẫn HTTPS `/wuwa-map/`.

## 1. Chuẩn bị ứng dụng

Yêu cầu Node.js 24+ và pnpm 11.

```bash
sudo useradd --system --home /var/lib/wuwa-map --shell /usr/sbin/nologin wuwa-map
sudo install -d -o wuwa-map -g wuwa-map -m 0750 /var/lib/wuwa-map
sudo install -d -o wuwa-map -g wuwa-map -m 0750 /var/backups/wuwa-map

sudo mkdir -p /opt/wuwa-map
sudo git clone https://github.com/Acceleratorer/wuwa-map.git /opt/wuwa-map/current
sudo chown -R "$USER":wuwa-map /opt/wuwa-map/current
cd /opt/wuwa-map/current
pnpm install --frozen-lockfile
pnpm build
```

## 2. Cấu hình môi trường

```bash
sudo install -o root -g wuwa-map -m 0640 \
  deploy/wuwa-map.env.example /etc/wuwa-map.env
```

Kiểm tra lại `APP_ORIGIN`, `DATABASE_PATH` và đường dẫn Node trước khi bật
service. Không đặt secret hay invite code trong file repo.

## 3. Bật systemd

```bash
sudo install -o root -g root -m 0644 \
  deploy/wuwa-map.service /etc/systemd/system/wuwa-map.service
sudo systemctl daemon-reload
sudo systemctl enable --now wuwa-map
sudo systemctl status wuwa-map
```

Health check nội bộ:

```bash
curl http://127.0.0.1:8787/wuwa-map/api/health
```

## 4. Nối Nginx

Chèn nội dung `deploy/nginx-location.conf` vào `server` HTTPS đang phục vụ
`accel.io.vn`, sau đó:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Kiểm tra public:

```bash
curl https://accel.io.vn/wuwa-map/api/health
```

## 5. Tạo link một lần cho bạn

```bash
cd /opt/wuwa-map/current
sudo -u wuwa-map /usr/bin/node --env-file=/etc/wuwa-map.env \
  server/create-invite.mjs friend 72
```

Gửi riêng URL được in ra. Sau khi mở thành công, URL invite bị xóa khỏi thanh
địa chỉ và thiết bị giữ session bằng cookie `HttpOnly`.

## 6. Backup và quản lý thiết bị

Backup nhất quán ngay cả khi server đang chạy:

```bash
cd /opt/wuwa-map/current
sudo -u wuwa-map /usr/bin/node --env-file=/etc/wuwa-map.env \
  server/backup-database.mjs \
  "/var/backups/wuwa-map/wayfinder-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Liệt kê thiết bị:

```bash
sudo -u wuwa-map /usr/bin/node --env-file=/etc/wuwa-map.env \
  server/manage-devices.mjs list
```

Thu hồi một thiết bị bằng `session` ID được in ở lệnh trên:

```bash
sudo -u wuwa-map /usr/bin/node --env-file=/etc/wuwa-map.env \
  server/manage-devices.mjs revoke <session-id>
```

Thu hồi toàn bộ thiết bị của profile `friend`:

```bash
sudo -u wuwa-map /usr/bin/node --env-file=/etc/wuwa-map.env \
  server/manage-devices.mjs revoke-all friend --confirm
```

Thu hồi session không xóa progress. Sau đó có thể tạo invite mới để liên kết
lại thiết bị.

## 7. Update bản mới

```bash
cd /opt/wuwa-map/current
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart wuwa-map
sudo systemctl status wuwa-map
```

Luôn tạo backup trước khi update production.

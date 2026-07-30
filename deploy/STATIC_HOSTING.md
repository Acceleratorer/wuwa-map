# Deploy lên shared hosting tại /wuwa-map/

Cách này phù hợp với hosting chỉ phục vụ file tĩnh qua LiteSpeed, Apache hoặc
PHP. Không cần chạy Node server.

## Build có private map pack

Đặt hai file private trước khi build:

```text
public/map-packs/private/default-map-pack.json
public/map-packs/private/wuwa-906.webp
```

Sau đó:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Upload **nội dung bên trong** thư mục `dist/` vào:

```text
public_html/wuwa-map/
```

URL cuối:

```text
https://accel.io.vn/wuwa-map/
```

Sau khi thay build, hard refresh một lần để service worker nhận cache version
mới.

## Tiến trình trên static hosting

Static hosting không có `/wuwa-map/api/*`, nên ứng dụng tự chạy local-only:

- Tiến trình lưu trong IndexedDB của trình duyệt.
- Đóng tab hoặc khởi động lại máy không làm mất dữ liệu.
- Xóa site data, dùng trình duyệt khác hoặc đổi thiết bị sẽ tạo kho tiến trình
  khác.
- Dùng Export/Import JSON để chuyển tiến trình sang thiết bị khác.

Nếu chỉ một người bạn dùng trên một trình duyệt thì đây là cấu hình đơn giản
nhất. Nếu cần hai thiết bị đồng bộ cùng tiến trình, phải triển khai Node + SQLite
theo `deploy/README.md` hoặc bổ sung backend phù hợp với hosting PHP.

## Giới hạn truy cập

Có thể dùng tính năng Password Protect Directory của hosting panel để khóa thư
mục `/wuwa-map/`. Không commit file mật khẩu hoặc credential vào repository.

## Dữ liệu bên thứ ba

Các file dưới `public/map-packs/private/` bị Git ignore. Chỉ upload bản đồ và
dữ liệu mà bạn có quyền sử dụng hoặc phân phối; giữ attribution trong map pack.

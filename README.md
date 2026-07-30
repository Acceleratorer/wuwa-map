# Wayfinder Map

Local-first progress map dành cho nhóm nhỏ. Ứng dụng không cần tài khoản KURO:
tiến trình được ghi vào IndexedDB trước, sau đó đồng bộ với backend riêng khi
thiết bị đã claim một invite hợp lệ.

## Tính năng hiện có

- Leaflet `CRS.Simple` cho bản đồ game dạng ảnh phẳng.
- Đánh dấu/hoàn tác marker đã nhặt.
- Bộ lọc danh mục, tìm kiếm và ẩn điểm đã hoàn thành.
- Hai profile mặc định: `owner` và `friend`.
- Invite dùng một lần để liên kết thiết bị với đúng profile.
- Session thiết bị mặc định 3650 ngày để người dùng không phải đăng nhập lại.
- IndexedDB tự động lưu profile, settings, map pack và tiến trình.
- Node HTTP + SQLite backend chạy cùng origin.
- Session opaque token trong cookie `HttpOnly`, `SameSite=Strict`.
- Optimistic local writes và tự đồng bộ lại khi mạng quay lại.
- Export/import backup JSON.
- Import map pack JSON có validation.
- PWA metadata và runtime cache cho bản production.
- CLI backup SQLite và thu hồi thiết bị.
- Basemap và marker demo do dự án tự tạo.

Nếu backend không hoạt động, frontend tự rơi về local-only mode. Những thay đổi
offline được giữ trạng thái pending và đẩy lên server sau khi kết nối lại.

## Chạy local

Yêu cầu Node.js 24+ và pnpm 11.

```bash
pnpm install
```

Copy cấu hình:

```powershell
Copy-Item .env.example .env
```

Chạy backend và frontend ở hai terminal:

```bash
pnpm dev:api
pnpm dev
```

Vite proxy API về backend Node. URL frontend local là:

```text
http://127.0.0.1:5173/wuwa-map/
```

Build production:

```bash
pnpm build
pnpm serve
```

Full-stack server chạy tại:

```text
http://127.0.0.1:8787/wuwa-map/
```

## Tạo invite thiết bị

Tạo invite cho profile `friend`, hết hạn sau 72 giờ:

```bash
pnpm invite friend 72
```

CLI sẽ in một URL dạng:

```text
https://example.com/wuwa-map/?invite=<one-time-code>
```

Người dùng chỉ cần mở URL một lần. Backend:

1. Hash invite code trước khi tra SQLite.
2. Đánh dấu invite đã sử dụng.
3. Sinh session token ngẫu nhiên.
4. Chỉ lưu SHA-256 của session token trong database.
5. Gửi token thật bằng cookie `HttpOnly + SameSite=Strict`.

Không gửi invite URL qua kênh công khai. Nếu link bị lộ trước khi claim, hãy tạo
invite khác.

Sau khi claim, thiết bị mặc định được ghi nhớ 3650 ngày. Người dùng chỉ cần link
mới nếu chủ map thu hồi session, người dùng bấm đăng xuất, cookie bị xóa hoặc
trình duyệt xóa dữ liệu website.

## Backup SQLite

Tạo snapshot nhất quán kể cả khi backend đang chạy:

```bash
pnpm backup
```

Hoặc chọn đường dẫn đích:

```bash
pnpm backup /path/to/backups/wayfinder-2026-07-30.sqlite
```

CLI từ chối ghi đè file có sẵn và chạy `PRAGMA quick_check` trước khi báo thành
công.

## Quản lý thiết bị

Liệt kê tất cả session đang hoạt động:

```bash
pnpm devices list
```

Chỉ liệt kê profile `friend`:

```bash
pnpm devices list friend
```

Thu hồi đúng một thiết bị:

```bash
pnpm devices revoke <session-id>
```

Thu hồi mọi thiết bị của profile `friend`:

```bash
pnpm devices revoke-all friend --confirm
```

Thu hồi thiết bị không xóa progress. Có thể tạo invite mới để liên kết lại.

## Map pack

Ứng dụng không commit dữ liệu hoặc asset của bên thứ ba. File ví dụ nằm tại
[`src/data/demo-map-pack.json`](src/data/demo-map-pack.json).

Schema tối thiểu:

```json
{
  "schemaVersion": 1,
  "id": "my-map",
  "title": "Tên bản đồ",
  "attribution": "Nguồn và license của dữ liệu",
  "image": {
    "src": "https://example.com/map.webp",
    "width": 1600,
    "height": 1000
  },
  "categories": [
    {
      "id": "chest",
      "label": "Rương",
      "color": "#f8c963",
      "symbol": "R"
    }
  ],
  "markers": [
    {
      "id": "chest-001",
      "categoryId": "chest",
      "title": "Rương số 1",
      "x": 420,
      "y": 320,
      "description": "Ghi chú tùy chọn"
    }
  ]
}
```

Quy ước tọa độ:

- `(0, 0)` nằm ở góc trên bên trái của ảnh.
- `x` tăng sang phải.
- `y` tăng xuống dưới.
- Marker phải nằm trong `image.width` và `image.height`.
- `id` của category và marker phải duy nhất.
- `color` dùng dạng `#RRGGBB`.

Basemap có thể là URL HTTPS, data URL hoặc đường dẫn tương đối tới file đã được
deploy cùng ứng dụng. Chỉ import dữ liệu và hình ảnh mà bạn có quyền sử dụng.

## Map pack riêng tự động

Khi file sau tồn tại, ứng dụng tự dùng nó thay cho map demo:

```text
public/map-packs/private/default-map-pack.json
```

Basemap được tham chiếu trong JSON cũng nên nằm dưới
`public/map-packs/private/`. Toàn bộ thư mục này đã bị Git ignore nên có thể
build bản dùng cá nhân mà không commit dữ liệu hoặc asset bên thứ ba.

Converter cho release data của `9268/wuwa-map`:

```bash
pnpm convert:9268 -- \
  --db data/private/9268-latest/stitched/map_items.db \
  --coords data/private/9268-latest/stitched/map_coords.json \
  --state 906 \
  --country 4 \
  --items qzx_01,qzx_02,qzx_03,qzx_04 \
  --image map-packs/private/wuwa-906.webp \
  --image-width 4973 \
  --image-height 4956 \
  --output public/map-packs/private/default-map-pack.json
```

Converter dùng parameterized SQLite queries, lọc marker ngoài ảnh và đổi tọa
độ game sang pixel của basemap đã resize. Repo `9268/wuwa-map` phát hành code
và bộ dữ liệu tổng hợp theo MIT; quyền với bản đồ và game asset gốc vẫn thuộc
KURO GAMES. Chỉ public những file bạn có quyền phân phối.

## Local profile link

Khi chưa bật backend, vẫn có thể chọn profile local bằng:

```text
https://example.com/wuwa-map/?profile=friend
```

Ứng dụng nhớ profile được chọn trong IndexedDB. Vì dữ liệu hiện là local-only,
mở cùng link trên thiết bị khác sẽ tạo một kho tiến trình riêng.

## Backend và database

Các biến môi trường được mô tả trong [`.env.example`](.env.example):

- `APP_ORIGIN`: danh sách origin được phép thực hiện request thay đổi state.
- `DATABASE_PATH`: đường dẫn SQLite có filesystem bền.
- `SESSION_DAYS`: thời gian cookie/session, mặc định 3650 ngày.
- `COOKIE_SECURE`: phải là `true` trên production HTTPS.
- `TRUST_PROXY`: chỉ bật khi app nằm sau reverse proxy đáng tin cậy.

Backup file SQLite và frontend JSON export định kỳ. Không commit database,
WAL/SHM files hoặc `.env` vào repository.

Backend áp dụng:

- Parameterized SQLite queries.
- One-time invite.
- Hashed opaque session tokens.
- Origin validation và `SameSite=Strict` chống CSRF.
- Rate limiting theo IP.
- Security headers và CSP.
- Request body limit 64 KB.
- Tách quyền progress theo profile trong session.

`node:sqlite` vẫn được Node 24 đánh dấu experimental/release-candidate tùy minor
version. Với production quan trọng, pin và kiểm thử đúng Node runtime trước khi
nâng phiên bản.

## Triển khai production

Build output nằm trong `dist/`. Web server cần phục vụ toàn bộ thư mục dưới:

```text
/wuwa-map/
```

Nếu muốn deploy ở path khác, sửa `base` trong `vite.config.ts` và build lại.

Production nên đặt Node server sau HTTPS reverse proxy và cấu hình:

```env
NODE_ENV=production
APP_ORIGIN=https://accel.io.vn
COOKIE_SECURE=true
DATABASE_PATH=/path/to/persistent-data/wayfinder.sqlite
TRUST_PROXY=true
```

Bộ cấu hình systemd, Nginx và hướng dẫn từng bước cho
`https://accel.io.vn/wuwa-map/` nằm tại
[`deploy/README.md`](deploy/README.md).

Nếu hosting chỉ nhận file tĩnh/PHP, dùng hướng dẫn
[`deploy/STATIC_HOSTING.md`](deploy/STATIC_HOSTING.md). Chế độ này vẫn lưu tiến
trình bằng IndexedDB nhưng không đồng bộ giữa các thiết bị.

## Kiểm thử

```bash
pnpm test
```

Test suite hiện kiểm tra:

- Invite chỉ claim được một lần.
- Cookie có `HttpOnly` và `SameSite=Strict`.
- API yêu cầu session.
- Profile chỉ đọc/ghi progress của chính mình.
- Foreign origin và input không hợp lệ bị từ chối.
- TypeScript và production build.

## Phase tiếp theo

1. Upload production build có private map pack lên `accel.io.vn/wuwa-map/`.
2. Thêm data adapter cho nguồn dữ liệu có license rõ ràng.
3. Diễn tập restore từ SQLite backup trên môi trường staging.

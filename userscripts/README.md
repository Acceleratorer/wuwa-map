# KURO Local Progress Userscript

Userscript này chạy trực tiếp trên `https://www.kurobbs.com/mc/map/` và chỉ lưu tiến trình trong browser của người dùng. Nó không đăng nhập hộ, không gọi API lưu tiến trình của KURO, không crawl database, và không gửi dữ liệu về server riêng.

## Cài đặt cho bạn non-tech

1. Cài Tampermonkey cho Chrome/Edge.
2. Tạo script mới.
3. Dán toàn bộ nội dung file `kuro-local-progress.user.js`.
4. Save script.
5. Mở `https://www.kurobbs.com/mc/map/`.

Nếu script chạy đúng, góc dưới bên phải sẽ có panel `Local Progress`.

## Cách dùng

1. Click một marker trên map KURO.
2. Nếu URL có đủ `state`, `country`, `items`, `x`, `y`, panel sẽ hiện marker hiện tại.
3. Bấm `Đánh dấu đã nhặt`.
4. Bấm lại nếu muốn bỏ đánh dấu.
5. Bấm `Export JSON` định kỳ để backup.
6. Khi đổi máy hoặc mất dữ liệu browser, dùng `Import JSON` để khôi phục.

## Giới hạn cố ý

- Tiến trình chỉ nằm trên browser đang dùng.
- Xóa dữ liệu website của `kurobbs.com`, dùng incognito, hoặc đổi browser sẽ mất progress nếu chưa export.
- Script không thể ghi progress vào account KURO khi không login.
- Tính năng làm mờ marker là best-effort vì KURO không cung cấp DOM/API ổn định cho userscript cá nhân.
- Nếu KURO đổi cấu trúc URL hoặc client UI, script có thể cần sửa lại.

## Dữ liệu lưu local

Mỗi marker được lưu bằng key dạng:

```text
country=<country>|state=<state>|item=<items>|x=<x>|y=<y>
```

File export là JSON thường, có thể mở ra kiểm tra được.

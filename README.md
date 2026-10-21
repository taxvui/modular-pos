# Modular POS

POS cho quán cà phê: tại chỗ, mang về, giao hàng; hướng tới SaaS nhiều tenant và đồng bộ offline.

**Trạng thái: MVP đang phát triển. Chưa sẵn sàng vận hành tại quán thật.**

## Phạm vi đã thống nhất

- Đăng nhập thật, phân quyền và cách ly tenant/chi nhánh.
- Menu, size/topping, sơ đồ bàn, đơn hàng và thanh toán.
- Mở/đóng ca, hủy/hoàn tiền có kiểm soát, báo cáo và nhật ký.
- Offline bền vững và đồng bộ chống trùng.
- **Tạm hoãn:** KDS, in, kho nguyên liệu/BOM. Flutter và các tích hợp mở rộng triển khai sau.

## Hiện đã triển khai

- `/account`: đăng ký/đăng nhập qua Supabase Auth; tạo thương hiệu và cửa hàng đầu tiên cho tài khoản đã xác nhận email; đọc cửa hàng theo RLS; đăng xuất.
- Menu theo cửa hàng, size/topping và giá; sơ đồ bàn; tạo/sửa đơn online với giá server, snapshot, version và idempotency. Mở/đóng ca, thu đủ tiền mặt/chuyển khoản xác nhận thủ công, hủy đơn/hoàn toàn bộ có lý do và báo cáo ngày. Chưa hỗ trợ thanh toán tách hoặc hoàn một phần.
- IndexedDB lưu đơn bền vững, outbox chống trùng, menu đã lưu và trang mở lại được khi mất mạng; đối soát/hủy đơn chưa lên server có biên nhận. Tải lại trang cần đăng nhập có mạng để truy cập đúng hàng đợi.
- Mời nhân viên bằng mã theo email, hai vai trò thu ngân/quản lý theo cửa hàng, đổi/ngừng quyền có audit và bảo vệ công việc chưa chốt.
- Phiên tự làm mới khi thao tác lâu; khi phiên không hợp lệ, giao diện trở về đăng nhập và giữ hàng đợi đã lưu.
- Yêu cầu lưu đơn online được ghi bền vững trước khi gửi; tải lại/đăng nhập lại có thể xác nhận bằng mã gốc nếu phản hồi bị mất.
- Tra cứu lịch sử đơn theo ngày/trạng thái/mã đơn hoặc khách; xem snapshot món, tiền đã thu/hoàn và lý do hủy, phân trang theo cửa hàng; chọn giao dịch cũ để hoàn toàn bộ có kiểm soát.
- Migration bổ sung cho cách ly tenant, kiểm soát chi nhánh, ràng buộc tenant trên khóa ngoại và chặn RPC sync chưa hoàn thiện.
- Kiểm thử xác thực, cách ly dữ liệu trên PostgreSQL nhúng (PGlite), smoke test pgTAP và CI Supabase.
- Graphify tạo graph, báo cáo và HTML qua GitHub Actions.

Trang `index.html` cũ là **demo bằng dữ liệu trong bộ nhớ**, không phải POS đã kết nối database. Các migration nghiệp vụ chỉ có comment và mã Flutter mẫu vẫn là backlog. Các helper domain cũ chưa chứng minh nghiệp vụ đã chạy end-to-end.

## Chạy kiểm tra

Yêu cầu Node.js 22, npm. Supabase CLI và Docker cần thiết cho bộ tích hợp đầy đủ.

```bash
npm ci
npm test
npm run build

supabase start
supabase db reset
supabase test db
```

PGlite dùng một Auth shim tối thiểu và bỏ qua extension pgcrypto (gen_random_uuid có sẵn). CI Supabase kiểm tra migrations nguyên bản, Auth schema thật và pgTAP. Đây là hai lớp kiểm tra khác nhau; pass PGlite không thay thế kiểm thử Supabase.

## Cấu hình và kiểm thử tài khoản

Đặt `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY` khi build, rồi mở `/account`. Không đưa service-role key vào biến công khai. Nếu chưa cấu hình, trang hiển thị lỗi cấu hình và khóa đăng nhập.

Chi tiết: [Hướng dẫn kiểm thử MVP](docs/development/mvp-foundation.md), [nhân viên](docs/development/staff-access.md), [phiên đăng nhập](docs/development/session-recovery.md), [lịch sử đơn](docs/development/order-history.md), [đối soát ca](docs/development/shift-history.md), [phục hồi lưu đơn](docs/development/order-save-recovery.md).

## Thứ tự triển khai

1. Nền tảng dữ liệu và Auth.
2. Menu, size/topping, sơ đồ bàn và luồng bán hàng online.
3. Ca, thanh toán, hủy/hoàn tiền, audit và báo cáo.
4. IndexedDB, outbox, retry, idempotency và xử lý xung đột.
5. Quản lý nhân viên và phục hồi phiên khi thao tác lâu.
6. [Pilot một cửa hàng/hai thiết bị](docs/development/two-device-pilot.md): CI có hai browser context dùng Auth/database thật; còn cần nghiệm thu trên thiết bị vật lý tại quán.

Không tuyên bố hoàn thành theo số lượng file, tên phase hoặc dữ liệu demo.

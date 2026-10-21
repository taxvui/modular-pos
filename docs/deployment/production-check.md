# Kiểm tra bản triển khai trước pilot

Công cụ này kiểm tra một website đã được triển khai và Supabase được cấu hình trong website đó. Nó không đăng nhập, tạo tài khoản, gửi email, lưu đơn, thu/hoàn tiền, chạy migration hoặc sửa cấu hình. Không cần đưa mật khẩu hay khóa quản trị cho công cụ.

## Build và cấu hình

Dùng Node.js 22. Cấu hình `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` trong môi trường build. Vẫn hỗ trợ `NEXT_PUBLIC_SUPABASE_ANON_KEY` với JWT có role `anon`; các tên không có tiền tố `NEXT_PUBLIC_` tương ứng cũng là fallback. Nếu nhiều biến cùng tồn tại, ưu tiên: public publishable → public anon → publishable → anon.

Build kiểm tra URL và loại khóa trước khi ghi output, từ chối `sb_secret_…`, JWT `service_role`/`authenticated` và cấu hình thiếu một nửa. Việc đọc claim JWT chỉ kiểm tra loại khóa; Supabase xác minh tính hợp lệ thực tế khi công cụ gọi API. Tham khảo [tài liệu API keys chính thức của Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

Không cấu hình cả URL lẫn key vẫn build được trang yêu cầu cấu hình để phát triển/demo; bản đó không vượt qua kiểm tra triển khai. Khóa bí mật không được dùng trong biến frontend.

`npm run build` sinh `deployment-manifest.json` trong output với mã băm SHA-256 của shell, cấu hình công khai, service worker và health. Manifest là phép đối chiếu các file cùng lần build, không phải chữ ký chứng thực hoặc bằng chứng database sẵn sàng. Vercel không cache HTTP file cấu hình/manifest/health; Service Worker vẫn giữ shell có phiên bản và đợi các tab cũ đóng như thiết kế hiện tại.

## Chạy trên website thực

Thay URL ví dụ bằng origin HTTPS thực tế, không kèm tài khoản, query hoặc đường dẫn:

```bash
npm run check:deployment -- --url https://pos.example.com
npm run check:deployment -- --url https://pos.example.com --json
```

Chỉ khi kiểm tra local có chủ ý:

```bash
npm run check:deployment -- --url http://127.0.0.1:3000 --allow-local --json
```

Exit code 0: các phép kiểm tra của công cụ đạt. Exit code 1: có kiểm tra thất bại; exit code 2: đối số không hợp lệ. Báo cáo chỉ chứa tên phép kiểm tra và mã lỗi, không in key, nội dung phản hồi API hay dòng dữ liệu đọc được. Mỗi request có timeout, giới hạn kích thước phản hồi; không đi theo redirect backend hoặc redirect website sang origin khác. Redirect cùng origin như `/account.html` → `/account` được hỗ trợ.

| Phép kiểm tra | Điều kiện đạt |
| --- | --- |
| Manifest và file giao diện | Đủ tài nguyên bắt buộc, HTTP/MIME đúng, mã băm khớp; phát hiện file cũ trộn build mới và SPA fallback HTML thay cho JS |
| Cấu hình công khai | URL hợp lệ, HTTPS với môi trường thực, chỉ publishable/anon key |
| Health và Service Worker | Health chỉ tuyên bố static build, không nhận vơ kiểm tra DB; worker có đúng build ID đã thay marker |
| Supabase Auth | API settings truy cập được bằng public key và bật email; chưa chứng minh email đến hộp thư |
| Bảng ẩn danh | organizations/orders/payments/refunds/audit_logs trả không có dòng hoặc lỗi quyền; không log nội dung dòng nếu phát hiện lộ |
| RPC ẩn danh | store context, order/shift history, receipt, events và open-order tồn tại với chữ ký gọi tương ứng và từ chối anon bằng lỗi quyền |

Các POST chỉ gọi RPC đọc với UUID rỗng; không gọi RPC bán hàng/nhân viên/bootstrap. Việc kiểm tra anon không thay thế kiểm thử quyền bằng tài khoản có đăng nhập hoặc chứng minh mọi RPC/bảng của hệ thống đều an toàn. Website có lớp đăng nhập/protection ở hạ tầng có thể bị báo lỗi nếu công cụ không đọc được các tài nguyên công khai cần cho shell.

## Trình tự nghiệm thu tại quán

1. Ghi commit/build được triển khai và môi trường Supabase tương ứng. Áp dụng migrations qua quy trình của môi trường, không chạy `db reset` trên dữ liệu thật.
2. Có bản sao lưu theo cấu hình dự án và thử khôi phục vào môi trường tách biệt. Đối chiếu số đơn/thanh toán/hoàn, tổng tiền/ca và quyền tenant; ghi thời điểm bản sao, mốc dữ liệu phục hồi, thời gian khôi phục và người xác nhận. Công cụ này chưa làm bước đó.
3. Chạy kiểm tra deployment trên URL thực và lưu báo cáo đã bỏ thông tin nhạy cảm cùng commit triển khai.
4. Thử đăng ký/xác nhận email qua SMTP thực, đăng nhập và xoay phiên theo cấu hình của dự án. Ghi nhận email thực nhận, redirect đúng website và thao tác khi phiên hết hiệu lực.
5. Thực hiện [pilot hai thiết bị vật lý](../development/two-device-pilot.md), dùng tài khoản/cửa hàng kiểm thử riêng. Đối chiếu đơn trùng, revision, chuyển bàn, offline, phản hồi mất, hoàn tiền và chốt ca. Kiểm tra mọi máy không còn tiền mặt chờ đồng bộ trước khi chốt.
6. Ghi người thực hiện, thiết bị/trình duyệt, mạng, kết quả thực tế và lỗi còn mở; chỉ đánh dấu đạt cho bước đã thực hiện.

**Trạng thái của repo:** CI chạy công cụ trên bản build và Supabase cục bộ thật; đó không phải kết quả kiểm tra URL production, SMTP thực nhận, backup/restore hoặc thiết bị của quán. Các mục này luôn nằm trong `notVerified` của báo cáo. KDS, in và kho nguyên liệu vẫn tạm hoãn.

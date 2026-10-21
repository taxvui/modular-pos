# Kiểm thử nền tảng MVP

## Thiết lập

1. Dùng Supabase local/staging riêng; không chạy `db reset` trên dữ liệu thật.
2. Chạy `supabase start`, `supabase db reset`, `supabase test db`.
3. Đặt URL và anon/publishable key công khai tương ứng vào `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` ở môi trường build.
4. Chạy `npm run build`, phục vụ thư mục `public`, mở `/account.html` (Vercel: `/account`).
5. Tạo tài khoản bằng email/mật khẩu; xác nhận email. Supabase local cung cấp hộp thư kiểm thử, URL hiển thị trong `supabase status`. Không dùng các email mẫu trong seed như tài khoản đăng nhập.
6. Đăng nhập, tạo thương hiệu và cửa hàng. Tải lại trang, đăng nhập lại: cửa hàng vẫn tồn tại.
7. Tạo tài khoản khác: không được thấy thương hiệu/cửa hàng của tài khoản trước.

## Giới hạn của đợt code

- Access token và refresh token chỉ giữ trong bộ nhớ; tải lại phải đăng nhập. Có làm mới phiên tự động khi thao tác, chưa hỗ trợ đăng nhập offline; xem [phục hồi phiên](session-recovery.md).
- Email phải được xác nhận để tạo workspace. Đăng ký tự động cần cấu hình SMTP, redirect URL và chính sách Auth trên Supabase staging/production.
- Mỗi tài khoản tự tạo tối đa một workspace. Chủ quán có thể mời nhân viên và quản lý hai vai trò theo cửa hàng; xem [hướng dẫn nhân viên](staff-access.md). Menu và lưu đơn online được mô tả ở bên dưới.
- Bảng core mở quyền đọc qua RLS; ghi trực tiếp từ client bị khóa. RPC bootstrap ghi dữ liệu atomically, không nhận actor/role từ client.
- RPC sync và view chẩn đoán cũ bị thu hồi quyền truy cập vì chưa đủ an toàn. Client cũ cần được thay bằng sync engine thật ở đợt sau.
- Migration mới giữ nguyên các migration cũ, dùng ràng buộc composite để chặn ghép tenant/store/device sai. Nếu dữ liệu cũ vi phạm, migration phải dừng để sửa dữ liệu; không bỏ constraint.
- Các file test pgTAP rỗng đã loại khỏi bộ test. Chưa triển khai KDS, in, kho/BOM.
- Trước khi mở production cần kiểm thử Supabase Auth end-to-end, email/SMTP, backup/restore và luồng bán hàng thật.

## Kiểm thử tự động

`npm test` chạy domain test cũ, Auth client và PostgreSQL/PGlite. Bộ database tạo hai tenant, kiểm tra đọc chéo, gán role chéo, thành viên chưa có quyền, quyền theo chi nhánh, khóa membership, chống tự nâng quyền, chặn sync chưa hoàn thiện và bootstrap.

CI còn dựng Supabase, reset database từ migrations nguyên bản và chạy assertion pgTAP. Kiểm thử này cần được theo dõi sau khi đẩy code.

## Menu và đơn hàng online

Sau khi đăng nhập, chủ cửa hàng có thể mở phần Thực đơn & đơn hàng:

1. Thêm món, một hoặc nhiều size/giá, topping tùy chọn. Có thể chỉnh giá hoặc ngừng bán từng size.
2. Thêm bàn nếu phục vụ tại chỗ.
3. Chọn món, size, topping, số lượng; thêm vào giỏ và lưu đơn mang về/tại bàn/giao hàng. Giao hàng cần điện thoại và địa chỉ.
4. Mở lại đơn đã lưu. Server kiểm tra revision; nếu máy khác đã sửa, thao tác cũ bị từ chối.
5. Server tính giá từ catalog và lưu snapshot. Gửi lại nguyên yêu cầu với cùng operation ID không tạo đơn mới; tái sử dụng ID với nội dung khác bị từ chối.

Đơn đang mở có thể thu tiền sau khi mở ca. Chưa triển khai gộp/tách, tự đồng bộ hai màn hình hay lưu giỏ offline. Giỏ chưa lưu sẽ mất khi tải lại trang. Danh sách hiển thị tối đa 200 đơn đang mở gần nhất. Giá được tính lại theo catalog khi lưu, kể cả sửa đơn.

RPC đọc/ghi bảo vệ bằng tenant/store + permission. Owner hiện có quyền quản lý; thành viên chỉ có quyền truy cập chi nhánh chưa tự động được phép bán hoặc sửa menu. Thay đổi món, giá và đơn được ghi audit. Các API sync cũ vẫn bị khóa.

## Ca, thu tiền và đối soát

- Mở ca của mình với tiền mặt đầu ca; mỗi thu ngân có tối đa một ca đang mở tại cửa hàng.
- Mở đơn đã lưu, nhập số tiền khách đưa, xác nhận thu đủ. Server ghi thanh toán và hoàn tất đơn trong cùng transaction, trả tiền thừa. Không thể thu lần hai dù gửi request với mã khác.
- Chuyển khoản yêu cầu xác nhận đã kiểm tra tiền vào tài khoản và nhận đúng tổng tiền. Chưa tự động xác minh giao dịch ngân hàng.
- Không thu tiền trên giỏ chưa lưu. Đơn đã thanh toán không được sửa; hủy đơn đang mở/hoàn toàn bộ thanh toán cần quyền và lý do.
- Hoàn tiền theo phương thức gốc; cần ca đang mở, phải thực sự hoàn tiền cho khách trước khi ghi nhận. Hoàn tiền mặt bị chặn nếu số tiền dự kiến trong ca không đủ. Không có tích hợp ngân hàng thực hiện chuyển tiền thay người dùng.
- Chốt ca nhập thực đếm. Server lưu tiền dự kiến, tiền thực đếm và chênh lệch; ca đã đóng không thu thêm được.
- Báo cáo ngày theo timezone cửa hàng, tách tổng thu và khoản hoàn theo ngày phát sinh. Đây là báo cáo thu tiền cơ bản, chưa phải báo cáo thuế/lợi nhuận/giá vốn.
- Giới hạn hiện tại: thu đủ một lần, hoàn toàn bộ một lần; chưa hỗ trợ tách phương thức thanh toán, hoàn một phần, chi tiền ngoài hoàn đơn. Danh sách thanh toán/ca trên UI giới hạn 100 bản ghi, hiển thị 20 ca gần nhất. Các ca cũ hơn không được chọn từ UI hiện tại.
- Browser CI kiểm tra UI 390px/1280px với API giả lập. Kiểm thử database dùng PostgreSQL và Supabase; browser test không thay thế tích hợp Auth/Supabase end-to-end thật.

## Tích hợp HTTP thật trên CI

Job Supabase còn tạo hai tài khoản xác nhận sẵn trên Auth cục bộ, đăng nhập lấy JWT thật, tạo workspace/menu/đơn qua PostgREST và kiểm tra cách ly tenant. Hai yêu cầu thu tiền đồng thời với cùng operation ID phải tạo đúng một thanh toán. Sau đó job hoàn tiền, đóng ca và kiểm tra đối soát. Script từ chối chạy nếu URL Supabase không phải localhost/127.0.0.1; không ghi hoặc in credentials. Dữ liệu kiểm thử bị hủy cùng môi trường CI.

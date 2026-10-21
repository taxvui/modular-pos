# Nhân viên và quyền theo cửa hàng

Áp dụng migration `20261021000600_store_staff_access.sql` sau các migration POS hiện có. Build lại và tải lại các tab để nhận giao diện mới. Không cần cấu hình email gửi lời mời trong đợt này: chủ quán sao chép mã và tự chuyển cho đúng nhân viên.

## Luồng sử dụng

1. Chủ quán chọn cửa hàng, mở **Nhân viên & quyền cửa hàng**, nhập email và chọn vai trò.
2. Sao chép mã hiện trong phiên này. Mã ngẫu nhiên 256 bit có hiệu lực 24 giờ, chỉ cấp quyền một lần cho tài khoản có email đã xác nhận trùng với lời mời. Máy chủ chỉ lưu SHA-256 của mã; API danh sách và audit không trả mã hoặc hash.
3. Nhân viên đăng nhập, nhập tên và mã tại **Nhận quyền cửa hàng**. Tên chỉ dùng để tạo hồ sơ nếu tài khoản chưa có hồ sơ. Hệ thống chọn cửa hàng vừa được cấp quyền.
4. Chủ quán tải danh sách nhân viên để đổi vai trò hoặc ngừng quyền, kèm lý do. Quyền ở cửa hàng khác được giữ nguyên. Mã chờ của nhân viên tại cửa hàng đang sửa cũng bị thu hồi.

Đóng trang, tải lại, đổi cửa hàng hoặc đăng xuất sẽ xóa mã khỏi bộ nhớ giao diện. Nếu mất mã, thu hồi mã chờ rồi tạo mã mới. Khi mất phản hồi trong cùng phiên, thử lại đúng thao tác để dùng lại mã và operation ID cũ.

## Hai vai trò cố định

| Chức năng | Thu ngân | Quản lý cửa hàng |
| --- | --- | --- |
| Tạo/sửa đơn, thu tiền, mở/chốt ca cá nhân | Có | Có |
| Quản lý menu, bàn/khu vực | Không | Có |
| Hủy đơn, hoàn tiền, xem báo cáo | Không | Có |
| Duyệt đối soát đơn offline | Không | Có |
| Mời nhân viên, đổi quyền | Không | Không |

Chỉ chủ sở hữu hoặc vai trò tùy chỉnh có `pos.staff.manage` được quản lý nhân viên. Không thể tự thay quyền của mình, thay quyền chủ sở hữu, hoặc dùng giao diện này ghi đè quyền cấp tổ chức/quyền tùy chỉnh. Preset hệ thống phải có đúng tập quyền; cấu hình sai làm RPC từ chối thay vì cấp quyền rộng hơn.

## Thu hồi quyền và đơn offline

Quyền được tra từ cơ sở dữ liệu với JWT đang dùng, không cần chờ JWT hết hạn. Các lệnh bán hàng, thu tiền, ca và đối soát kiểm tra lại quyền sau khóa cửa hàng, ngăn yêu cầu đang chờ chạy tiếp bằng quyền cũ. Mã đã nhận chỉ trả biên nhận khi gọi lại, không tái kích hoạt nhân viên bị ngừng quyền.

Máy chủ từ chối ngừng quyền nếu nhân viên còn ca chưa chốt hoặc phiếu đối soát offline OPEN tại cửa hàng. Chủ quán phải yêu cầu nhân viên đồng bộ các thiết bị và chốt ca trước khi ngừng quyền. Máy chủ không thể biết đơn chỉ còn trong IndexedDB của thiết bị chưa kết nối; giao diện yêu cầu xác nhận công việc này. Không xóa hàng đợi tại thiết bị khi thay quyền.

Danh sách nhân viên phân trang 100 người; danh sách mã hiển thị 100 mã gần nhất. Những thay đổi quyền dùng revision và operation ID để phát hiện bản cũ và tránh ghi lặp khi thử lại; audit ghi người thao tác, cửa hàng, lý do và kết quả. Các bảng nội bộ bị khóa truy cập trực tiếp bằng RLS/grants, chỉ RPC được ủy quyền được thay đổi.

## Kiểm chứng

- `npm test`: PostgreSQL qua PGlite kiểm tra email, quyền từng cửa hàng, idempotency, revision, ca/đối soát chưa xong, bảo vệ chủ sở hữu và mã cũ.
- `npm run build` rồi `node --test tests/browser/*.test.mjs`: giao diện điện thoại, nhận mã khi chưa có cửa hàng, mất phản hồi, xóa mã khi đăng xuất, đổi quyền và xác nhận đồng bộ trước ngừng quyền.
- CI Supabase: pgTAP kiểm tra ACL/RLS; `node --test tests/integration/*.test.mjs` dùng Auth thật và RPC qua HTTP, bao gồm mở ca đồng thời với thu hồi quyền.

Phạm vi này không triển khai KDS, in, kho nguyên liệu/BOM hoặc giao diện thiết kế vai trò tùy chỉnh.

# Chuyển đơn sang bàn trống

Mở đơn tại bàn đã lưu, không có thay đổi chưa lưu. Trong **Chuyển đơn sang bàn khác**, chọn bàn đích, nhập lý do 3–500 ký tự và bấm chuyển. Chủ quán, quản lý hoặc thu ngân có `pos.order.write` tại cửa hàng được thao tác. Chỉ dùng khi kết nối server; không đưa chuyển bàn vào hàng đợi offline.

Server kiểm tra quyền hiện hành, đơn còn mở, revision khớp, bàn đích đang hoạt động cùng cửa hàng, khác bàn nguồn và không có đơn đang mở. Giao dịch dùng cùng khóa cửa hàng với lưu đơn/thu tiền/đồng bộ, khóa hàng đơn và ràng buộc duy nhất một đơn mở mỗi bàn. Hai đơn tranh cùng bàn chỉ một đơn thành công. Máy còn revision cũ phải tải lại trước khi sửa hoặc thu tiền.

Chỉ `position_id`, `revision`, `updated_at` thay đổi. Mã đơn, khách, món, topping, số lượng và snapshot giá giữ nguyên; không tính lại giá hoặc kiểm tra lại trạng thái bán của món khi chỉ chuyển bàn. Lưu sửa đơn thông thường vẫn áp dụng giá thực đơn hiện tại như trước.

Mỗi thao tác có operation ID; gửi lại cùng actor, nội dung và ID trả biên nhận gốc, không chuyển lần nữa hoặc ghi audit lần nữa, kể cả đơn đã được thanh toán sau đó. Thay actor hoặc nội dung với cùng ID bị chặn. Quyền được kiểm tra trước khi trả lại biên nhận. Audit `pos.order.transferred` lưu người chuyển, bàn nguồn/đích, revision và lý do; bảng biên nhận không mở đọc/ghi trực tiếp cho client.

Nếu mất phản hồi, giao diện giữ yêu cầu gốc trong phiên, khóa sửa giỏ/thu tiền và cho **Xác nhận lại chuyển bàn**. Sau xác nhận, tải dữ liệu mới nhất để tiếp tục. Yêu cầu chuyển chưa xác nhận không được lưu bền vững qua tải lại trang: nếu đã tải lại, đăng nhập rồi mở lại đơn để kiểm tra bàn hiện tại trước khi chuyển tiếp. Revision cũ không thể áp dụng lần nữa. Không có nút tự chuyển ngược hoặc tự gộp vào bàn đang có đơn.

## Triển khai và kiểm thử

Áp dụng migration `20261021000900_table_transfer.sql` trước bản giao diện. Migration thêm bảng biên nhận riêng (RLS, thu hồi quyền client) và RPC `rpc_transfer_order`. Không chạy reset trên production.

- PGlite: quyền, snapshot giá/món ngừng bán, bàn không hợp lệ/đã có đơn, rollback, revision, idempotency và audit.
- pgTAP: RPC và ACL bảng/hàm trên Supabase thật.
- Tích hợp HTTP thật: hai request trùng, hai đơn tranh bàn, chuyển bàn tranh với thu tiền.
- Browser: phản hồi bị mất, retry nguyên yêu cầu, khóa giỏ, giải phóng khi bàn đã có đơn, chữ không thực thi HTML, màn hình 390px và đăng xuất.
- Pilot hai thiết bị: thu ngân chuyển bàn với phản hồi mất rồi retry; máy còn revision cũ bị chặn thu tiền, tải lại nhận bàn mới và thanh toán đúng giá.

KDS, in, kho nguyên liệu, gộp/tách bàn tiếp tục ngoài phạm vi đợt này.

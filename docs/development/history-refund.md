# Chọn giao dịch cũ để hoàn tiền

Trước đây biểu mẫu hoàn chỉ liệt kê 100 thanh toán mới nhất. Nay chủ quán/quản lý có thể mở **Tra cứu lịch sử đơn**, tìm đơn, bấm **Xem chi tiết** rồi **Chọn giao dịch này để hoàn tiền**. Chọn giao dịch chỉ chuẩn bị biểu mẫu, không ghi hoàn tiền và không thực hiện chuyển tiền.

Nút chọn chỉ có khi quyền hiện tại của giao diện cho phép hoàn, đơn PAID có thanh toán và chưa có khoản hoàn. Khi bấm, giao diện đọc lại chi tiết, kiểm tra lại quyền từ server và tải ca hiện tại. Cần có ca đang mở của chính người thực hiện tại cửa hàng này. Đơn đã hoàn ở màn hình khác không được chọn lại; cần xem khoản hoàn cũ thay vì trả tiền lần nữa.

Giao dịch được chọn từ lịch sử xuất hiện trong danh sách hoàn kể cả ngoài 100 thanh toán gần nhất. Biểu mẫu hiển thị đầy đủ mã đơn, mã thanh toán, số tiền hoàn toàn bộ, phương thức gốc và tên khách nếu có. Kiểm tra đúng giao dịch, hoàn đủ tiền theo phương thức gốc, nhập lý do và đánh dấu xác nhận trước khi ghi nhận. Hệ thống không tự chuyển tiền ngân hàng hoặc tự trả tiền mặt.

Đổi giao dịch, đổi ca hoặc sửa lý do làm bỏ xác nhận cũ; khi đổi giao dịch/ca lý do cũ cũng được xóa. Mỗi lần chọn lại từ lịch sử đều bắt đầu xác nhận mới. Thao tác đang gửi khóa các ô của biểu mẫu để không đổi giao dịch giữa chừng.

RPC hoàn hiện có vẫn kiểm tra quyền, ca, số dư tiền mặt, trạng thái đơn và chống hoàn trùng bằng ràng buộc/payment ID. Lỗi mất phản hồi khi đang ở cùng phiên dùng lại operation ID nếu thử lại nguyên biểu mẫu. Sau thành công, lựa chọn và xác nhận được xóa, chi tiết lịch sử được tải lại để hiển thị khoản hoàn. Không ghi đè/xóa thanh toán gốc.

Giao dịch lịch sử đang chọn được kiểm tra lại khi tải dữ liệu; nếu đã hoàn hoặc không còn PAID, nó bị bỏ khỏi lựa chọn. Đăng xuất, đổi cửa hàng hoặc hết phiên xóa lựa chọn và thông tin giao dịch khỏi biểu mẫu. Không lưu thông tin lựa chọn này vào IndexedDB.

Không có khóa đặt chỗ để hoàn tiền xuyên thiết bị: trong thời gian giữa chọn giao dịch và thao tác cuối, máy khác vẫn có thể xử lý. Cần phối hợp giữa người thực hiện trước khi thực sự trả tiền; server chỉ bảo đảm một khoản hoàn được ghi, không kiểm soát tiền đã trả thủ công. Nếu phải tải lại trang sau một lần mất phản hồi, tra cứu khoản hoàn trước khi trả tiền thêm.

Không cần migration mới; build lại và tải lại các tab. Phạm vi này vẫn hoàn toàn bộ một lần theo phương thức gốc, không hoàn một phần hoặc tách phương thức. KDS, in và kho nguyên liệu/BOM vẫn tạm hoãn.

## Kiểm chứng

- Browser: chọn giao dịch ngoài danh sách 100, hiện đúng số tiền/phương thức; bỏ xác nhận khi đổi; chặn giao dịch đã hoàn, mất quyền, chưa mở ca và thu ngân; thử lại mất phản hồi cùng operation ID.
- Supabase pilot: chủ quán mở ca riêng, tìm giao dịch thu ngân đã thu, hoàn từ lịch sử, mất phản hồi sau commit rồi thử lại; database chỉ có một khoản hoàn. Báo cáo ghi tổng thu 105.000đ và hoàn 70.000đ; ca hoàn từ 100.000đ còn 30.000đ, lệch 0.

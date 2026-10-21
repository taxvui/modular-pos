# Mở đơn đang chờ từ lịch sử

Trong **Tra cứu lịch sử đơn**, chọn ngày tạo đơn, trạng thái **Đang mở**, tìm theo mã hoặc thông tin khách rồi **Xem chi tiết → Mở đơn để sửa hoặc thu tiền**. Có thể dùng cho đơn không còn nằm trong danh sách nhanh 200 đơn đang mở gần nhất. Bộ lọc lịch sử vẫn giới hạn tối đa 93 ngày mỗi lần; có thể chọn khoảng cũ hơn khi biết ngày tạo đơn.

Việc mở chỉ tải dữ liệu vào trình soạn, không sửa trạng thái đơn, thêm audit, thu tiền hoặc tạo đơn mới. Nếu giỏ hiện tại có thay đổi chưa lưu, hệ thống giữ nguyên giỏ và yêu cầu lưu trước; có thể chủ động chọn **Đơn mới** để bỏ thay đổi rồi mở đơn cần xử lý. Nếu đang phục hồi yêu cầu lưu hoặc chưa xác nhận chuyển bàn, phải xác nhận yêu cầu đó trước.

Nút chỉ dành cho người có `pos.order.write` ở cửa hàng. Người chỉ có quyền báo cáo vẫn xem chi tiết/nhật ký nhưng không có nút mở để thao tác; server cũng kiểm tra quyền hiện hành. RPC `rpc_open_order` từ chối đơn đã thanh toán, đã hoàn, đã hủy, đơn khác tổ chức/cửa hàng và tài khoản bị ngừng quyền.

Khi bấm mở, RPC đọc lại header, revision và món trong cùng snapshot của câu lệnh PostgreSQL, thay vì dùng bản chi tiết đã xem trước đó. Món, size/topping, số lượng, đơn giá, khách và bàn lấy từ dữ liệu đã lưu. Món/bàn ngừng hoạt động vẫn có thể hiển thị để đối chiếu; bàn đã lưu không bị tự chuyển sang bàn khác. Chỉ đọc không tính lại giá. Lưu sửa sau đó vẫn kiểm tra thực đơn/giá hiện tại như luồng bán hàng hiện có; thu tiền theo tổng đã lưu và revision tương ứng. Máy khác sửa/thu tiền sau lần đọc vẫn được bảo vệ bởi kiểm tra revision/trạng thái ở server.

Khi đổi cửa hàng/đăng xuất trong lúc chờ, phản hồi cũ không được đưa vào trình soạn. Phản hồi sai mã đơn, trạng thái, số lượng hoặc tổng tiền không được dùng và giữ nguyên giỏ hiện tại. Tải lại trang vẫn cần đăng nhập có mạng; tính năng này không mở đơn server khi offline.

## Triển khai và kiểm thử

Áp dụng migration `20261021001100_open_order_snapshot.sql` trước giao diện. Migration thêm RPC chỉ đọc với quyền thực thi giới hạn; không thêm quyền ghi bảng hoặc thay dữ liệu cũ. Không chạy reset trên production.

- PGlite: hơn 200 đơn, snapshot giá/món/bàn ngừng bán, revision hiện tại, không tạo audit, quyền báo cáo/bán hàng và các trạng thái kết thúc.
- pgTAP: RPC và ACL trên Supabase thật.
- Browser: giữ giỏ chưa lưu, từ chối phản hồi sai đơn/đơn đã kết thúc, mở đúng revision/giá/bàn, thu tiền dùng revision mới, quyền chỉ báo cáo và phản hồi sau đăng xuất.
- API/pilot Supabase thật: đọc đơn sau chuyển bàn, từ chối đọc để sửa sau thanh toán, thu ngân mở lại từ lịch sử và thanh toán đúng bàn/tổng tiền mới.

KDS, in và kho nguyên liệu tiếp tục tạm hoãn.

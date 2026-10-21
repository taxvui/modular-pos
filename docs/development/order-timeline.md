# Nhật ký thao tác theo đơn

Trong **Tra cứu lịch sử đơn → Xem chi tiết → Nhật ký thao tác của đơn**, bấm **Tải nhật ký mới nhất**. Nhật ký tải riêng, không thay đổi giỏ đang soạn và không tự gửi thêm thao tác bán hàng.

RPC `rpc_order_events` chỉ đọc năm loại audit: lưu đơn, chuyển bàn, thu tiền, hủy đơn và hoàn tiền. Lần lưu có revision 1 hiển thị “Tạo đơn”. Khoản hoàn được nối qua thanh toán thuộc đúng đơn, cùng tổ chức/cửa hàng; không ghép theo actor hoặc thời gian. Thao tác offline đã đồng bộ qua RPC bán hàng cũng xuất hiện; hàng đợi chưa lên server không xuất hiện. Thử lại cùng operation ID không tạo thêm audit.

Mỗi bản ghi có thời gian theo múi giờ cửa hàng, tên và mã người thực hiện, mã audit, cùng thông tin phù hợp: revision/tổng đơn, bàn nguồn/đích, số tiền/phương thức, tiền khách đưa/tiền thừa, mã thanh toán/khoản hoàn/ca thực hiện và lý do. Tên người/bàn là tên hiện tại, không phải snapshot lịch sử; mã định danh được giữ để đối chiếu. Không suy luận thứ tự nhân quả giữa các bản ghi có thời gian bằng nhau.

Mỗi trang tối đa 50 bản ghi, mới nhất trước, con trỏ `(created_at,id)` ổn định khi có bản ghi mới. Trang sau/trước giữ con trỏ của lần tra cứu; tải nhật ký mới nhất bắt đầu từ trang đầu. Chi tiết đơn và nhật ký là hai lần đọc riêng, có thể khác thời điểm; tải lại để đối chiếu sau khi máy khác vừa thao tác.

Người có `pos.order.write` hoặc `pos.report.read` tại cửa hàng đọc được nhật ký của đơn ở cửa hàng đó, kể cả thu ngân không được đọc trực tiếp bảng audit. Quyền được kiểm tra hiện hành mỗi lần gọi RPC. Phản hồi chỉ chiếu các trường cần hiển thị; không trả nguyên `before_state`, `after_state`, metadata, thông tin khách trong payload hay audit ngoài danh sách cho phép. Đổi trang đơn, đổi cửa hàng hoặc đăng xuất xóa nhật ký; phản hồi của phiên cũ không được đưa lại vào màn hình.

## Triển khai và kiểm thử

Áp dụng migration `20261021001000_order_timeline.sql` trước giao diện. Migration thêm index audit theo thực thể và RPC chỉ đọc; không sửa bản ghi audit cũ, không mở quyền đọc trực tiếp bổ sung. Không chạy reset trên production.

- PGlite kiểm tra đúng đơn/thanh toán, audit hủy/hoàn/chuyển bàn, projection dữ liệu, quyền hiện hành, cursor và phân trang trùng thời gian.
- pgTAP kiểm tra hàm và ACL trên Supabase thật.
- Browser kiểm tra phân trang, giỏ hàng, HTML trong tên/lý do chỉ hiển thị văn bản, phản hồi sai đơn và phản hồi muộn sau đăng xuất.
- Pilot hai thiết bị xác minh một lần chuyển/thu/hoàn tương ứng một audit dù retry, thu ngân đọc được nhật ký của đơn và thấy đúng người hoàn tiền.

Đây là tra cứu thao tác bán hàng, chưa phải giao diện quản trị toàn bộ audit hoặc hệ thống lưu trữ tuân thủ. KDS, in và kho nguyên liệu tiếp tục tạm hoãn.

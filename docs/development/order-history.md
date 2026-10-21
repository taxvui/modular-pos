# Tra cứu lịch sử đơn

Áp dụng migration `20261021000700_order_history.sql`, build giao diện mới và tải lại các tab. Trong cửa hàng, mở **Tra cứu lịch sử đơn**, chọn khoảng ngày tạo đơn và bấm tìm. Để trống ngày sẽ dùng bảy ngày gần nhất theo múi giờ cửa hàng; mỗi lần tra cứu tối đa 93 ngày.

Có thể lọc tất cả, đang mở, đã thanh toán (gồm đơn đã hoàn), đã hủy hoặc đã hoàn tiền. Tìm theo phần đầu UUID đơn, tên hoặc số điện thoại khách; tìm tên không phân biệt hoa thường, vẫn phân biệt dấu tiếng Việt. Ký tự `%` và `_` là văn bản thông thường. Trạng thái thanh toán và khoản hoàn lấy từ các bảng giao dịch thực tế.

Mỗi trang tối đa 50 đơn, sắp theo ngày tạo giảm dần và UUID làm khóa phụ. Con trỏ trang giữ cặp ngày tạo/UUID để đơn mới xuất hiện không làm lặp dữ liệu ở trang kế tiếp. Thay bộ lọc sẽ bắt đầu lại trang đầu. Bấm tìm lại để thấy giao dịch mới; không có tự cập nhật realtime.

**Xem chi tiết** hiển thị toàn bộ mã đơn, ngày tạo, loại phục vụ/bàn, thông tin khách, món/size/topping, giá lúc bán, tổng đơn, tiền đã thu, khách đưa, tiền thừa, khoản hoàn và lý do hoàn/hủy. Giá lấy từ snapshot order_items; thay đổi menu không sửa giao dịch cũ. Thu ròng là tổng tiền thanh toán trừ tiền đã hoàn của riêng đơn này, không phải doanh thu theo ngày. Ngày tạo đơn, ngày thu và ngày hoàn có thể khác nhau.

Tra cứu không mở giỏ để sửa hoặc tự thu/hoàn tiền, không làm thay đổi giỏ đang soạn. Người có quyền hoàn tiền có thể chọn giao dịch từ chi tiết lịch sử để đưa vào biểu mẫu hoàn riêng, kể cả ngoài 100 thanh toán gần nhất; xem [hoàn tiền từ lịch sử](history-refund.md). Thu ngân có quyền ghi đơn hoặc người có quyền xem báo cáo được tra cứu tại cửa hàng đã cấp quyền. RPC kiểm tra quyền hiện tại trên từng yêu cầu; không cho anonymous hoặc tenant/cửa hàng khác đọc bằng cách đoán UUID.

Dữ liệu lịch sử không vào cache offline. Cần kết nối mạng để tìm và mở chi tiết; không hiển thị lịch sử đã tải của người trước khi đăng xuất/đổi cửa hàng/hết phiên. Không xóa hàng đợi IndexedDB. Danh sách chỉ bao gồm đơn đã tồn tại trên server, không bao gồm bản chỉ lưu tại thiết bị và đang chờ đồng bộ.

## Kiểm chứng

- PGlite: trạng thái, tìm kiếm literal, khoảng ngày/múi giờ Việt Nam, snapshot giá, khoản thu/hoàn, lý do hủy, trang trùng timestamp, cửa hàng khác và quyền bị thu hồi.
- Browser: lọc/chuyển trang, đổi bộ lọc trở về trang đầu, giữ giỏ, hiển thị khách/lý do bằng text an toàn và xóa dữ liệu khi đăng xuất.
- Pilot hai browser context với Supabase thật: sau thu/đồng bộ, tìm đúng đơn đã thanh toán qua giao diện, xem số tiền đã thu và tiền thừa.

Không triển khai xuất file, in hóa đơn, hoàn một phần, chỉnh đơn đã thanh toán hoặc báo cáo thuế/giá vốn trong đợt này. KDS, in và kho nguyên liệu/BOM vẫn tạm hoãn.

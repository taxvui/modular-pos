# Lịch sử và đối soát ca

Sau khi đăng nhập và chọn cửa hàng, mở **Lịch sử & đối soát ca**, chọn khoảng ngày mở ca, trạng thái rồi tải danh sách. Mặc định 7 ngày, tối đa 93 ngày mỗi lần tra cứu. Mỗi trang có 50 ca; nút trước/sau dùng con trỏ thời gian và ID để không lặp ca khi có ca mới. Giao dịch trong ca có phân trang riêng 50 bản ghi, sắp theo thời gian, loại và ID.

Thu ngân có `pos.shift.manage` chỉ xem ca do mình mở. Người có `pos.report.read` xem toàn cửa hàng được cấp quyền. Ba RPC kiểm tra quyền hiện hành tại mỗi lần đọc; đổi cửa hàng hoặc đăng xuất xóa nội dung. Helper kiểm tra quyền không được gọi trực tiếp bởi authenticated/anon.

Chi tiết tách thu/hoàn tiền mặt và chuyển khoản; tiền khách đưa và tiền thừa; số thanh toán, khoản hoàn và thu ròng. Tiền mặt dự kiến = tiền đầu ca + thu tiền mặt − hoàn tiền mặt. Chuyển khoản không làm tăng tiền mặt trong két. Hoàn ghi vào ca thực hiện hoàn, kể cả khi thanh toán gốc thuộc ca đã đóng. Bản chốt lưu sẵn (dự kiến, thực đếm, chênh lệch) được trình bày riêng, không tính lại hoặc sửa ca cũ do hoàn ở ca sau.

Đây là màn hình chỉ đọc, chỉ gồm giao dịch đã lên server; hàng đợi tại máy chưa đồng bộ chưa được cộng. Ca đang mở có thể thay đổi sau thời điểm đọc: dùng tải lại để cập nhật. Thu ròng không phải lợi nhuận hay báo cáo thuế. Không bổ sung thu/chi ngoài hoàn đơn, KDS, in hay kho nguyên liệu.

## Triển khai và xác minh

Áp dụng migration `20261021000800_shift_history.sql` sau các migration hiện có, trước khi phát hành giao diện. Migration thêm index phục vụ phân trang, helper riêng và ba RPC: `rpc_shift_history`, `rpc_shift_summary`, `rpc_shift_transactions`; không sửa ledger cũ. Production dùng quy trình migration của môi trường; không chạy `db reset` trên dữ liệu thật.

`npm test` kiểm tra quyền, múi giờ, phân trang trùng thời gian, tiền thừa/chuyển khoản và hoàn khác ca bằng PGlite. `supabase test db` kiểm tra hàm/ACL trên Supabase. Browser fixture kiểm tra thu ngân, phân trang, văn bản không thực thi HTML, giỏ hàng và đăng xuất. Pilot hai thiết bị với Supabase thật kiểm tra ca thu ngân giữ 205.000đ sau khi chủ quán hoàn 70.000đ trong ca khác, và ca chủ quán còn 30.000đ từ 100.000đ đầu ca.

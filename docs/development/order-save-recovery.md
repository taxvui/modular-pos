# Phục hồi yêu cầu lưu đơn online

Trước khi gọi `rpc_save_order`, giao diện ghi operation ID, toàn bộ payload và snapshot giỏ vào IndexedDB, theo endpoint/tài khoản/tổ chức/cửa hàng. Không ghi token hoặc mật khẩu. Nếu không lưu được bền vững, không gửi yêu cầu mới lên server.

Khi nhận biên nhận hợp lệ, giao diện xóa ý định đang chờ. Nếu mất mạng, lỗi 5xx, lỗi xác thực/quyền hoặc phản hồi không hợp lệ, ý định được giữ để xác nhận lại. **Yêu cầu lưu đơn chưa xác nhận** hiển thị mã gốc và nút **Xác nhận lại yêu cầu gốc**. Giỏ, chuyển sang đơn mới và mở đơn khác bị khóa trong lúc chưa rõ kết quả; bấm Lưu đơn cũng thử lại yêu cầu gốc, không tạo operation ID mới.

Sau tải lại trang, đóng/mở trình duyệt hoặc đăng nhập lại, đúng tài khoản chọn đúng cửa hàng sẽ thấy yêu cầu chờ. Nội dung/operation ID được dùng nguyên vẹn; server trả biên nhận idempotent nếu đã ghi. Nếu bản sửa bị từ chối do revision, đơn đã hoàn tất, món/bàn không hợp lệ hoặc lỗi validation xác định, yêu cầu được giải phóng để người dùng sửa giỏ/mở lại đơn. Các lỗi quyền/xác thực được giữ vì việc bị từ chối hiện tại không chứng minh lần trước chưa ghi; cần khôi phục đúng quyền và đối soát với quản lý.

Yêu cầu mới bị mất mạng vẫn chuyển sang outbox đơn mới với cùng operation ID như trước. Ghi outbox và xóa ý định online trong cùng một transaction IndexedDB: máy dừng trước commit giữ ý định cũ, sau commit giữ đơn trong outbox. Không có khoảng trống mất cả hai bản ghi hoặc tự tạo mã thay thế. Sửa đơn server bị mất mạng giữ ý định gốc và cần xác nhận lại có mạng, không nhập vào outbox đơn mới.

Một yêu cầu lưu online chưa xác nhận được giữ cho mỗi scope trên cùng trình duyệt. Giao dịch IndexedDB ngăn tab khác ghi đè ý định này. Tab khác gặp ý định cũ phải xác nhận nó trước; giỏ khác đang soạn tại tab đó được giữ khi xác nhận thành công. Dọn dẹp phản hồi cũ không được xóa ý định mới có operation ID khác.

Đăng xuất/đổi cửa hàng/hết phiên xóa thông tin đang hiển thị, không xóa dữ liệu chờ của tài khoản trước. Không cho phép tự bỏ một yêu cầu chưa rõ kết quả bằng nút tạo mã mới. Đây không phải tự lưu mọi giỏ chưa bấm Lưu; giỏ chưa gửi và thay đổi chưa lưu vẫn có thể mất khi tải lại. Không xóa dữ liệu trình duyệt khi còn công việc chưa xác nhận.

Khi yêu cầu giao diện đang chạy, các ô soạn đơn cũng bị khóa và thao tác nền cùng generation không chạy chồng, tránh nội dung thay đổi giữa lúc chụp payload và xử lý mất phản hồi. RPC vẫn là lớp xác thực/phân quyền/idempotency cuối cùng. Không có migration database mới; build lại và tải lại tab để nhận module mới.

## Kiểm chứng

- Unit: ghi trước gửi, không gửi khi IndexedDB lỗi, giữ ý định khi kết quả chưa rõ, xóa khi từ chối xác định, xác thực biên nhận và giữ ý định nếu lỗi dọn dẹp.
- Browser: server ghi nhưng phản hồi 500, tải lại/đổi tài khoản/đăng nhập lại, xác nhận cùng mã/nội dung và chỉ có một đơn. Hai tab tranh ghi và dọn dẹp ý định cũ không xóa ý định mới.
- Supabase thật: browser nhận 503 sau khi server đã ghi; tải lại và đăng nhập lại, thử lại nhận `replayed=true`, số đơn trên database vẫn là một trước khi tiếp tục pilot hai màn hình.

KDS, in và kho nguyên liệu/BOM tiếp tục tạm hoãn.

# Phiên đăng nhập khi làm việc lâu

Auth client giữ access token trong bộ nhớ. Giao diện dùng sessionStorage để lưu refresh token và ID tài khoản theo dự án, giúp [khôi phục phiên khi điều hướng](navigation-session.md) trong cùng tab qua Supabase. Không lưu mật khẩu, access token hoặc token vào localStorage, IndexedDB hay cache của Service Worker. Khôi phục sau tải lại cần có mạng.

Trước một yêu cầu cần đăng nhập, nếu token còn không quá 30 giây theo thời hạn Auth trả về, client làm mới phiên. Nếu API trả 401, client làm mới rồi gửi lại đúng yêu cầu tối đa một lần. Các yêu cầu đồng thời dùng chung một lần đổi token; phản hồi 401 đến muộn dùng token vừa được đổi. Nội dung ghi và operation ID được chụp trước khi gửi, không thay đổi khi thử lại.

Lỗi mạng, 429 và 5xx khi đổi token giữ phiên trong bộ nhớ để người dùng thử lại; client không lặp vô hạn. 403 hoặc lỗi nghiệp vụ không kích hoạt đổi token và không tự gửi lại yêu cầu ghi. Mã bị từ chối, phản hồi đổi token không hợp lệ, hoặc 401 sau lần thử lại yêu cầu đăng nhập mới.

Khi phiên kết thúc, giao diện ẩn cửa hàng/bán hàng, xóa danh sách cửa hàng, danh tính và mã mời đang hiển thị. Đăng xuất xóa phiên tại máy ngay trước khi gọi Auth. Phản hồi thuộc phiên cũ không được khôi phục token hoặc dữ liệu cho tài khoản mới.

Hàng đợi đã lưu trong IndexedDB được giữ nguyên, gắn với tài khoản/cửa hàng ban đầu. Đăng nhập lại đúng tài khoản để kiểm tra và tiếp tục đồng bộ cùng operation ID. Giỏ chưa lưu vào hàng đợi hoặc server không được bảo đảm phục hồi khi phiên kết thúc. Phiên offline vẫn chỉ làm việc trong tab đã xác thực trước đó; không triển khai đăng nhập offline hoặc tự phục hồi phiên qua lần mở lại trang.

Mọi quyền cửa hàng vẫn được kiểm tra ở database. Đổi token không tạo hoặc khôi phục quyền đã bị thu hồi. Phiên trên máy khác không được chủ động đăng xuất bằng đợt thay đổi này; JWT do Supabase đã cấp vẫn theo chính sách hết hạn của máy chủ.

Tham khảo giao thức và cơ chế xoay token: [Supabase User sessions](https://supabase.com/docs/guides/auth/sessions).

## Kiểm chứng

- Unit: đồng thời, đổi token nối tiếp, 401 đến muộn, giữ nguyên nội dung ghi, lỗi mạng/429/5xx, từ chối đổi token, đăng xuất/đổi tài khoản khi có yêu cầu đang chạy.
- Browser: làm mới qua nhiều truy vấn menu, hết phiên đưa về đăng nhập, hàng đợi giữ nguyên và đồng bộ sau đăng nhập lại.
- Supabase CI: Auth thật đổi token, truy vấn PostgREST với token mới, thử lại đồng thời chỉ tạo một yêu cầu đổi token. Kiểm thử giả lập 401 ở biên HTTP, không giảm thời hạn JWT của production.

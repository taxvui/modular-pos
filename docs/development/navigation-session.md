# Phiên đăng nhập khi điều hướng

Trang chủ production chuyển hướng tạm thời từ `/` tới `/account` trước khi Vercel phục vụ file demo `index.html`. Demo vẫn ở `/demo`.

Giao diện truyền `sessionStorage` cho AuthClient. Sau khi đăng nhập hoặc xoay phiên, chỉ refresh token và ID tài khoản được lưu theo URL dự án Supabase; mật khẩu và access token không được ghi vào storage. Khi mở lại trang trong cùng tab, ứng dụng gửi refresh token đến Supabase và chỉ mở workspace sau khi server trả phiên mới đúng ID tài khoản. Quyền cửa hàng vẫn được đọc và kiểm tra lại trên server.

Đăng xuất hoặc phiên bị từ chối xóa thông tin khôi phục. Phản hồi khôi phục đến muộn không thể phục hồi phiên đã đăng xuất. Lỗi mạng/503 giữ thông tin để có thể thử lại sau, nhưng không mở workspace bằng phiên chưa kiểm chứng. Nếu trình duyệt chặn storage, đăng nhập vẫn dùng được trong bộ nhớ của trang.

Storage chỉ tồn tại trong phạm vi tab theo cơ chế trình duyệt; đây không phải chế độ ghi nhớ đăng nhập vĩnh viễn hoặc chia sẻ phiên giữa các tab. Máy dùng chung cần đăng xuất khi dùng xong. Service Worker không cache Auth/API hoặc lưu token; worker mới vẫn chờ các tab cũ đóng để không thay code giữa lúc đang lưu đơn.

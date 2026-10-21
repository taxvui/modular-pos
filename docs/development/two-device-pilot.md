# Chạy thử một cửa hàng trên hai thiết bị

Bộ tự động `tests/e2e/two-device-pilot.test.mjs` dùng Supabase Auth/PostgREST/PostgreSQL thật tại localhost và hai browser context tách biệt, tương ứng một thu ngân dùng hai màn hình. Context A có kích thước điện thoại 390px, context B là màn hình 1280px. Browser không giả lập dữ liệu nghiệp vụ; chủ quán, thu ngân, menu và quyền được tạo trong Supabase cục bộ, hủy cùng môi trường CI.

## Phạm vi tự động

1. Thu ngân đăng nhập trên hai context, không thấy quản trị menu/nhân viên hoặc hoàn tiền.
2. Máy A mở ca 100.000đ; máy B tải lại và thấy cùng ca.
3. A lưu đơn 35.000đ. B mở đơn đó; A cập nhật thành 70.000đ. B lưu bản cũ bị từ chối và dữ liệu mới trên server được giữ nguyên.
4. B mở lại bản mới, thu 100.000đ, ghi thanh toán 70.000đ và trả lại 30.000đ. A dùng bản đang mở cũ không thể thu lần thứ hai.
5. A mất mạng, ghi nhận một đơn tiền mặt 35.000đ, khách đưa 50.000đ. Hàng đợi bền vững và chặn chốt ca ngay tại máy A.
6. A tải lại trang trong lúc offline bằng Service Worker đã cài. Khi có mạng, đăng nhập lại đúng tài khoản và thấy đơn chờ.
7. Máy chủ đồng bộ và ghi thanh toán nhưng phản hồi bị chặn ở mạng trình duyệt. Thử lại cùng operation ID nhận đúng biên nhận; không sinh đơn hoặc thanh toán mới.
8. B tải lại, chốt ca thực đếm 205.000đ = 100.000đ đầu ca + 70.000đ + 35.000đ. Độ lệch bằng 0; báo cáo có hai thanh toán, tổng thu 105.000đ.

Kiểm thử bỏ phản hồi sau khi `route.fetch()` đã nhận HTTP 200 từ máy chủ; kiểm tra database đã có đủ thanh toán trước lần thử lại. Đây là can thiệp có chủ ý ở đường truyền, không thay dữ liệu phản hồi nghiệp vụ.

## Chạy tại máy phát triển

Yêu cầu Docker, Supabase CLI, Node.js 22 và các thư viện Chromium của Playwright:

```bash
npm ci
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install --with-deps chromium
supabase start
supabase db reset
npm run build
node --test tests/e2e/*.test.mjs
supabase stop --no-backup
```

`supabase db reset` xóa dữ liệu Supabase phát triển cục bộ; chỉ chạy trên môi trường kiểm thử riêng. Script từ chối URL Supabase không phải localhost/127.0.0.1. Chỉ cấu hình URL/public anon key được phục vụ cho browser; service-role key và mật khẩu fixture giữ trong tiến trình test, không tạo trace/video/HAR hoặc in token. CI chạy bài này trong job `supabase-database` sau migration, pgTAP và tích hợp API.

## Trước khi chạy tại quán

Bộ tự động mô phỏng hai thiết bị bằng hai context trong một Chromium. Vẫn cần chạy trên hai thiết bị vật lý của quán để kiểm tra trình duyệt, dung lượng lưu trữ, mạng Wi-Fi/4G và thao tác thu ngân thực tế.

| Tình huống | Điều kiện chấp nhận |
| --- | --- |
| Hai máy cùng sửa đơn | Máy dùng bản cũ nhận thông báo; mở lại thấy bản mới; không mất món của máy vừa lưu |
| Hai máy thu cùng đơn | Chỉ có một thanh toán; số tiền và tiền thừa đúng |
| Mất mạng sau thu tiền tại máy | Đơn ở hàng đợi đúng tài khoản/cửa hàng; đồng bộ không tự thay giá hoặc ca |
| Đóng/mở lại trình duyệt | Đơn đã lưu tại máy còn nguyên; đăng nhập có mạng trước khi truy cập hàng đợi |
| Giá hoặc ca đổi khi máy offline | Đơn được giữ để đối soát; không tự tạo lại bằng operation ID mới |
| Hết phiên | Về đăng nhập khi phiên không hợp lệ; hàng đợi còn nguyên |
| Chốt ca | Kiểm tra tất cả thiết bị không còn đơn thu tiền chờ; tổng thu/hoàn và thực đếm khớp |
| Quyền nhân viên bị thu hồi | Thao tác server bị từ chối; không xóa hàng đợi cũ để che lỗi |

**Giới hạn cần tuân thủ:** máy B hoặc máy chủ không biết đơn chưa đồng bộ chỉ nằm trên máy A đang offline. Việc chặn chốt ca ở A không bảo đảm B biết hàng đợi đó. Trước khi chốt ca hoặc ngừng quyền nhân viên, yêu cầu đồng bộ và đối soát trên mọi thiết bị dùng ca/tài khoản đó. Dữ liệu hai màn hình hiện cần bấm **Tải lại dữ liệu**; chưa có realtime tự cập nhật.

Không dùng kết quả tự động để tuyên bố đã nghiệm thu tại quán, đã kiểm thử mất điện/hỏng thiết bị hoặc đã sẵn sàng production. SMTP, backup/restore database, chính sách vận hành và kiểm tra thiết bị thật vẫn cần xác nhận khi chạy pilot. KDS, in, kho nguyên liệu/BOM tiếp tục tạm hoãn.

Trước khi chạy pilot trên URL thực, dùng [hướng dẫn kiểm tra triển khai](../deployment/production-check.md). Kết quả công cụ không thay thế nghiệm thu thiết bị, SMTP và backup/restore.

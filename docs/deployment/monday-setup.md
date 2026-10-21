# Khởi tạo Monday và kết nối Vercel

Đã thực hiện ngày 22/10/2026 (Asia/Ho_Chi_Minh) theo lựa chọn dự án Monday.

| Thành phần | Môi trường đã cấu hình |
| --- | --- |
| Supabase | Monday — `uremxwklxjeliawxtquk`, vùng `ap-northeast-2` |
| Website production | https://modular-pos-nine.vercel.app |
| Vercel project | `modular-pos` |
| Commit giao diện | `fd964ff0b9ea7499d3369720277886448ce0016b` |
| Deployment | `dpl_H9bKiH9mTAY3fW6p3R924NqEioPJ` — READY |

## Database

Monday được khôi phục từ trạng thái tạm dừng. Trước khi khởi tạo, dự án chưa có bảng `public`, lịch sử migration hoặc người dùng Auth. Đã áp dụng 24 migration hiện có và migration `20261021224856_pin_ledger_trigger_search_path.sql`: tổng cộng 34 bảng `public`, tất cả bật RLS. Lịch sử migration khớp phiên bản nguồn để những lần cập nhật tiếp theo không chạy lại phần khởi tạo.

Dữ liệu khởi tạo là metadata hệ thống cho `catalog`, `pos` và 9 quyền. Không chạy `supabase/seed.sql`, không tạo tài khoản, cửa hàng, đơn, thanh toán hoặc hoàn tiền mẫu. KDS, in và kho nguyên liệu vẫn tạm hoãn; các file migration đánh dấu giữ chỗ không có nghĩa các module đó đã được triển khai.

Đã cố định `search_path` cho hai hàm trigger; cảnh báo `function_search_path_mutable` không còn. Advisor vẫn báo 32 hàm SECURITY DEFINER mà authenticated có quyền gọi và 6 bảng RLS không có policy: đây là RPC có kiểm tra quyền tenant/store và bảng nội bộ từ chối truy cập trực tiếp. Không mở policy hoặc gỡ quyền RPC chỉ để xóa cảnh báo. Kết quả kiểm tra anon dưới đây chỉ xác nhận các endpoint được liệt kê trong công cụ.

## Kết nối và kiểm tra production

Đã đặt `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` trong môi trường **production** của Vercel rồi redeploy commit trên. Không lưu giá trị khóa trong Git; không dùng service-role/secret key ở frontend. Preview chưa được cấp database production.

Lệnh kiểm tra:

```bash
node scripts/check-deployment.mjs --url https://modular-pos-nine.vercel.app --json
```

Kết quả: 31/31 phép kiểm tra đạt, gồm manifest/hash tài nguyên, cấu hình công khai, static health, service worker, Auth settings, 5 bảng ẩn danh và 6 RPC đọc từ chối anon. `npm test`: 135/135 đạt; `npm run build`: đạt.

## Bắt đầu sử dụng

Mở website production, chọn **Tạo tài khoản**, xác nhận email rồi đăng nhập. Sau đó tạo không gian làm việc/cửa hàng trong giao diện; bước này gán quyền chủ sở hữu cho tài khoản đã xác nhận. Tiếp tục khai báo menu, giá và nhân viên bằng dữ liệu thực.

Chưa kiểm chứng việc nhận email, redirect Auth, luồng bán hàng có đăng nhập trên production, backup/restore hoặc thiết bị vật lý. Cần hoàn thành các bước [nghiệm thu tại quán](production-check.md#trình-tự-nghiệm-thu-tại-quán) trước khi dùng cho giao dịch thực. Không reset database production hoặc nạp seed demo để thử nghiệm.

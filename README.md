# LamMuse

Ứng dụng desktop Electron quản lý tạo ảnh/video qua tài khoản Muse, hàng đợi nhiều tài khoản, proxy, storyboard, thư viện và ghép video bằng FFmpeg.

Source trong repo là bản LamMuse đã chỉnh sửa từ bản cài đặt hiện có; không bao gồm mã nguồn Electron/Chromium, FFmpeg hoặc binary bên thứ ba. Metadata tác giả và giấy phép gốc được giữ trong `package.json`.

## Chạy phát triển

Yêu cầu Node.js/npm và Google Chrome. Trên Windows:

```sh
npm install
npm start
```

Ứng dụng mở profile Chrome riêng cho mỗi tài khoản. Đăng nhập Muse bằng cửa sổ Chrome được app mở. Dịch vụ Muse và kết nối Internet cần hoạt động để tạo nội dung.

## Kiểm thử

```sh
npm test
```

Lệnh trên chạy 18 bộ kiểm thử dùng trang Muse/dữ liệu giả, không gửi prompt tạo video thật. Kiểm thử tích hợp Chrome thật chạy riêng bằng `node scripts/test.cjs --integration`; bài này mở profile tạm và cần môi trường cho phép Chrome/CDP. Lần kiểm tra hiện tại, phần tích hợp Chrome chưa qua (Chrome đóng trong môi trường chạy kiểm thử).

## Đóng gói Windows

Chuẩn bị FFmpeg/FFprobe Windows x64 và DLL/giấy phép cần thiết trong `vendor/ffmpeg/`, xem README ở thư mục đó. Sau đó:

```sh
npm run dist:win
```

Bộ cài NSIS được xuất vào `dist/`. Cấu hình build dùng Electron 33.4.11, cùng phiên bản của bản cài đặt gốc. Cấu hình đóng gói từ source này cần kiểm chứng trên máy build Windows trước khi phân phối; bộ cài NSIS đã tạo riêng trước đó không được commit ở đây.

## Quy tắc chuyển tài khoản

- Chỉ chọn tài khoản đang bật, đã xác minh phiên và hạn mức phù hợp.
- Muse từ chối, không trả kết quả hoặc hết thời gian xử lý: ngừng giao việc mới cho tài khoản, giữ prompt/ảnh và chuyển task sang tài khoản khác.
- Không còn tài khoản phù hợp: giữ task chờ. Chọn **Thử lại tài khoản** để cho phép tài khoản bị dừng nhận việc lại.
- Lỗi file/ảnh tại máy và lỗi đường truyền chưa có phản hồi rõ ràng từ Muse không được tự coi là tài khoản bị Muse từ chối.
- Phiên đăng nhập và hạn mức được kiểm tra lại khi dữ liệu quá 5 phút; khi lỗi sẽ chờ ít nhất 60 giây trước khi thử lại.
- Thông báo lỗi hiển thị trực tiếp trong thẻ tài khoản.

## Dữ liệu riêng tư

Để tương thích dữ liệu cũ, bản Windows vẫn sử dụng `%APPDATA%/HaoHao` cho tài khoản, cấu hình và profile Chrome. Đây là tên thư mục nội bộ; tên hiển thị là LamMuse. Video mặc định nằm trong thư mục Videos/MuseStudioPro, có thể đổi trong Cài đặt.

Không đưa thư mục dữ liệu này lên Git. Repo không chứa tài khoản Muse, cookie, token Facebook, mật khẩu proxy, lịch sử task, bản sao lưu hoặc video cá nhân. `.gitignore` chặn các tên file dữ liệu và binary phổ biến.

## Cấu trúc

- `main.js`, `preload.js`: tiến trình Electron và cầu nối IPC.
- `engine/`: điều phối, Chrome CDP, giao tiếp Muse, lưu trữ, FFmpeg và kiểm thử.
- `ui/`: giao diện HTML/CSS/JavaScript.
- `scripts/test.cjs`: chạy bộ kiểm thử bằng Node.js.
- `vendor/ffmpeg/`: vị trí chuẩn bị binary khi đóng gói, không commit binary.

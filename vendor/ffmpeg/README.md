# FFmpeg cho bộ cài Windows

Đặt bản FFmpeg/FFprobe Windows x64 hợp lệ để phân phối vào thư mục này trước khi chạy `npm run dist:win`.

Nếu dùng bản liên kết động, cần đủ các DLL tương ứng (`avcodec`, `avdevice`, `avfilter`, `avformat`, `avutil`, `swresample`, `swscale`) và các thông báo giấy phép đi kèm bản build đó.

Binary không được commit vào repository. Chạy phát triển và quản lý tài khoản không yêu cầu FFmpeg; ghép cảnh/thêm nhạc cần có FFmpeg và FFprobe.

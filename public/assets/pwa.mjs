const label = document.getElementById('offlineReady');
function connection() {
  document.getElementById('connectionStatus').textContent = navigator.onLine
    ? 'Có kết nối mạng. Server sẽ kiểm tra lại giá và ca khi đồng bộ.'
    : 'Đang mất mạng. Giữ trang mở để lưu đơn tại máy; khôi phục phiên sau khi tải lại cần kết nối mạng.';
}
connection();
window.addEventListener('online', connection);
window.addEventListener('offline', connection);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async registration => {
    function monitor(worker) {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !registration.active) label.textContent = 'Chưa lưu được trang để mở offline. Hãy giữ trang hiện tại mở.';
        waiting();
      });
    }
    monitor(registration.installing);
    navigator.serviceWorker.ready.then(() => {
      label.textContent = 'Đã lưu trang để mở lại khi mất mạng. Đăng nhập vẫn cần kết nối mạng.';
      waiting();
    });
    function waiting() {
      if (registration.waiting) label.textContent = 'Có phiên bản mới. Đồng bộ đơn và kết thúc ca trước khi đóng các tab để cập nhật.';
    }
    waiting();
    registration.addEventListener('updatefound', () => {
      monitor(registration.installing);
    });
  }).catch(() => { label.textContent = 'Chưa lưu được trang để mở offline. Hãy giữ trang hiện tại mở.'; });
} else {
  label.textContent = 'Trình duyệt này chưa hỗ trợ lưu trang để mở offline. Hãy giữ trang mở.';
}

function retryPolicy(settings = {}) {
  return {
    attempts: Number.isInteger(settings.downloadRetryAttempts) && settings.downloadRetryAttempts >= 0 && settings.downloadRetryAttempts <= 10 ? settings.downloadRetryAttempts : 3,
    delay: [1, 3, 5, 10, 30, 60].includes(settings.downloadRetryDelay) ? settings.downloadRetryDelay * 1000 : 5000,
  };
}
function retryable(error) {
  if (['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(error?.code)) return false;
  if (/服务器的分段响应发生变化|下载文件大小不一致|超出范围的数据|缓存不完整/.test(error?.message || '')) return false;
  const status = Number(/HTTP (\d{3})/.exec(error?.message || '')?.[1]);
  return !status || status === 408 || status === 429 || status >= 500;
}
module.exports = { retryPolicy, retryable };

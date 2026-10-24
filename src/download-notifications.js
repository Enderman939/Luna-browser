function notifyDownload({ enabled, browser, entry, name, file, isPrivate, Notification, reveal }) {
  if (!enabled) return;
  browser?.downloadNotice?.(entry || { name, file });
  browser?.notice('下载完成：' + name);
  if (isPrivate || (browser?.downloadForeground ? browser.downloadForeground() : browser?.window.isFocused()) || !Notification.isSupported()) return;
  try {
    const notification = new Notification({ title: 'luna · 下载完成', body: name });
    notification.on('click', () => reveal(file));
    notification.on('failed', () => {});
    notification.show();
  } catch { /* An unavailable system notification must not fail a completed download. */ }
}
module.exports = { notifyDownload };

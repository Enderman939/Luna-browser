const $ = id => document.getElementById(id);
let statusTimer, fontSize = 18;
async function action(name) {
  const result = await window.pageTool.action(name);
  if (result?.cancelled || name === 'print' || name === 'open-original') return;
  $('status').textContent = result?.error || (name.startsWith('copy') ? '已复制' : name === 'save-image' ? '图片已保存' : '');
  clearTimeout(statusTimer); statusTimer = setTimeout(() => { $('status').textContent = ''; }, 3000);
}
for (const name of ['copy-link', 'open-original', 'close', 'copy-image', 'save-image', 'print']) $(name).onclick = () => action(name);
function size(delta) { fontSize = Math.max(14, Math.min(28, fontSize + delta)); $('article-body').style.fontSize = fontSize + 'px'; }
$('smaller').onclick = () => size(-2); $('larger').onclick = () => size(2);
document.addEventListener('keydown', event => { if (event.key === 'Escape') action('close'); });
window.pageTool.onAppearance(value => window.lunaAppearance.apply(value.appearance, value.dark, 'tools'));
window.pageTool.data().then(data => {
  window.lunaAppearance.apply(data.appearance, data.dark, 'tools'); document.body.dataset.kind = data.kind; $('tool-title').textContent = data.title;
  if (data.kind === 'reading') {
    $('reader').hidden = false; $('heading').textContent = data.heading || '阅读模式'; $('byline').textContent = data.byline || new URL(data.url).hostname;
    for (const block of data.blocks) {
      const node = document.createElement(['h1', 'h2', 'h3', 'h4', 'blockquote', 'pre'].includes(block.tag) ? block.tag : 'p');
      if (block.tag === 'li') node.className = 'list-item'; node.textContent = block.text; $('article-body').append(node);
    }
  } else {
    $('image-view').hidden = false; $('page-title').textContent = data.pageTitle || data.title; $('preview').src = data.image; $('preview').alt = data.title;
    $('url').textContent = data.url; $('image-help').textContent = data.kind === 'qr' ? '使用手机扫码打开此页面' : '可复制图片或保存为 PNG 文件';
  }
});

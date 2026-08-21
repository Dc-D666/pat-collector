'use strict';

// 全局工具：格式化、转义、文件图标、弹窗、Toast
window.Utils = (() => {
  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '-';
    let n = Number(bytes);
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
  }

  function formatTime(iso) {
    if (!iso) return '-';
    const s = String(iso);
    // 数据库返回 "YYYY-MM-DD HH:mm:ss" → 原样显示（零时区转换）
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
    // ISO 字符串兜底
    const d = new Date(s);
    if (isNaN(d.getTime())) return '-';
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function extOf(name) {
    const i = String(name || '').lastIndexOf('.');
    return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
  }

  // 扩展名 → 图标类别
  // 扩展名 → 图标类别（2026-08-22：emoji 改 TDesign 图标名，经 Icons.icon() 渲染）
  const ICON_RULES = [
    [/^(jpe?g|png|gif|bmp|webp|svg|ico|tiff?|heic)$/, { icon: 'image', color: '#F3ECDD' }],
    [/^(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/, { icon: 'video', color: '#FBE7E2' }],
    [/^(mp3|wav|flac|aac|ogg|m4a|wma)$/, { icon: 'music', color: '#F3E8DC' }],
    [/^(doc|docx)$/, { icon: 'file', color: '#F0E6D6' }],
    [/^(xls|xlsx|csv)$/, { icon: 'chart-bar', color: '#E7EFDC' }],
    [/^(ppt|pptx)$/, { icon: 'file', color: '#F9E8D8' }],
    [/^pdf$/, { icon: 'book', color: '#FCE8E4' }],
    [/^(zip|rar|7z|tar|gz)$/, { icon: 'folder', color: '#F7EFD8' }],
    [/^(py|js|ts|c|cpp|java|html|css|json|ipynb)$/, { icon: 'code', color: '#E4EFE4' }],
    [/^(stl|obj|glb|gltf|fbx|blend)$/, { icon: 'app', color: '#EFE7DE' }],
    [/^(txt|md)$/, { icon: 'file', color: '#F2EDE4' }],
  ];

  function getFileIcon(name) {
    const ext = extOf(name);
    for (const [re, icon] of ICON_RULES) {
      if (re.test(ext)) return icon;
    }
    return { icon: 'file', color: '#F2EDE4' };
  }

  // ---- 弹窗 ----
  let modalEl = null;
  function openModal(html) {
    closeModal();
    modalEl = document.createElement('div');
    modalEl.className = 'modal-overlay';
    modalEl.innerHTML = `<div class="modal">${html}</div>`;
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
    document.getElementById('modal-root').appendChild(modalEl);
    return modalEl;
  }
  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
  }

  function confirm(message, { danger = false } = {}) {
    return new Promise((resolve) => {
      openModal(`
        <div class="modal-body">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">确定</button>
        </div>`);
      modalEl.querySelector('[data-act="ok"]').onclick = () => { closeModal(); resolve(true); };
      modalEl.querySelector('[data-act="cancel"]').onclick = () => { closeModal(); resolve(false); };
    });
  }

  // ---- Toast ----
  // opts.html = true：按 HTML 渲染（仅限内部拼接的受信内容，如含 Icons SVG 的消息）；
  // 默认 textContent（安全，防注入）
  function toast(message, opts) {
    const wrap = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    if (opts && opts.html) el.innerHTML = message;
    else el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // 上传实时速度计算器：每次传入已传字节，返回平滑后的速度（字节/秒）。
  // 用指数滑动平均（EWMA）平滑瞬时抖动，展示更稳定。
  function createSpeedTracker() {
    let last = null;
    let avg = 0;
    return (loaded) => {
      const now = Date.now();
      if (last === null) { last = { loaded, t: now }; return 0; }
      const dt = (now - last.t) / 1000;
      const dl = loaded - last.loaded;
      last = { loaded, t: now };
      if (dt <= 0 || dl < 0) return avg;
      const inst = dl / dt;
      avg = avg ? avg * 0.7 + inst * 0.3 : inst;
      return avg;
    };
  }

  // 上传进度文案：'12.6 MB / 198.8 MB · 1.2 MB/s'（speed 为 0 或未给时省略速度）
  function formatProgress(loaded, total, speed) {
    const base = formatSize(loaded) + ' / ' + formatSize(total);
    return speed > 0 ? base + ' · ' + formatSize(speed) + '/s' : base;
  }

  // 姓名拼音缩写候选选择器（昵称方案二）：输入姓名 → 后端返回多音字候选 → 渲染胶囊按钮。
  // existing：已有昵称（若在候选中则默认选中锁定）。
  // autoFirst（2026-08-20）：选「展示真实姓名」时也自动生成昵称兜底——自动选中第一个候选（不展示候选区）。
  async function initialsPicker(optionsEl, hiddenEl, name, existing, autoFirst) {
    optionsEl.innerHTML = '';
    hiddenEl.value = '';
    if (!name) return;
    let r;
    try {
      r = await API.get('/api/auth/pinyin-candidates?name=' + encodeURIComponent(name));
    } catch (_) { return; }
    const cands = (r && r.candidates) || [];
    if (!cands.length) {
      optionsEl.innerHTML = '<span style="font-size:12px;color:var(--text-dim);">无法生成姓名缩写，请选择展示真实姓名</span>';
      return;
    }
    optionsEl.innerHTML = cands.map((c) =>
      `<button type="button" class="btn btn-sm" data-initial="${c}" style="padding:6px 14px;font-weight:700;">${c}</button>`
    ).join('');
    const pick = (b, c) => {
      hiddenEl.value = c;
      optionsEl.querySelectorAll('[data-initial]').forEach((x) => x.classList.toggle('btn-primary', x === b));
    };
    optionsEl.querySelectorAll('[data-initial]').forEach((b) => {
      b.onclick = () => pick(b, b.dataset.initial);
    });
    if (existing && cands.includes(existing)) {
      const hit = optionsEl.querySelector('[data-initial="' + existing + '"]');
      if (hit) pick(hit, existing);
    } else if (autoFirst && cands.length) {
      const first = optionsEl.querySelector('[data-initial="' + cands[0] + '"]');
      if (first) pick(first, cands[0]);
    }
  }

  // ── 自研下拉组件（2026-08-21）──
  // 背景：QQ 内置浏览器（MQQBrowser/TBS 内核）对原生 <select> 支持不佳（点击不弹系统选择器，
  // 用户反馈「年级下拉点不动」）。用纯 div 列表实现下拉，任何 webview 都能用。
  // 用法：Utils.customSelect(wrapEl, { options, placeholder, value, onChange })
  //   options: [{value,label}] 或字符串数组；返回 { getValue, setValue, setOptions, close, destroy }
  //   实例同时挂到 wrapEl.__cs，便于外部（如 getValues）读取。
  let activeSelect = null; // 模块级：当前展开的实例（互斥：开一个收一个）
  function customSelect(wrap, opts) {
    const options = (opts.options || []).map((o) =>
      typeof o === 'string' ? { value: o, label: o } : o
    );
    let current = opts.value != null && opts.value !== '' ? String(opts.value) : '';
    let btn, list;
    wrap.classList.add('cs');
    wrap.innerHTML = `
      <button type="button" class="cs-btn" role="listbox" aria-haspopup="listbox">
        <span class="cs-label"></span>
        <span class="cs-arrow">▼</span>
      </button>
      <div class="cs-list" role="listbox"></div>`;
    btn = wrap.querySelector('.cs-btn');
    list = wrap.querySelector('.cs-list');

    function renderLabel() {
      const labelEl = wrap.querySelector('.cs-label');
      const hit = options.find((o) => String(o.value) === current);
      labelEl.textContent = hit ? hit.label : (opts.placeholder || '请选择');
      labelEl.classList.toggle('cs-placeholder', !hit);
    }
    function renderList() {
      list.innerHTML = options.map((o) =>
        `<div class="cs-item${String(o.value) === current ? ' cs-selected' : ''}" data-v="${String(o.value).replace(/"/g, '&quot;')}">${Utils.escapeHtml(o.label)}</div>`
      ).join('');
    }
    function close() {
      if (activeSelect === api) activeSelect = null;
      wrap.classList.remove('cs-open');
    }
    function toggle() {
      if (wrap.classList.contains('cs-open')) { close(); return; }
      if (activeSelect && activeSelect !== api) activeSelect.close();
      activeSelect = api;
      renderList();
      wrap.classList.add('cs-open');
      // 展开后把按钮滚动进可视区（移动端小屏列表可能溢出视口底部）
      const r = btn.getBoundingClientRect();
      if (r.top < 0 || r.bottom > (window.innerHeight || document.documentElement.clientHeight)) {
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.cs-item');
      if (!item) return;
      const v = item.dataset.v;
      current = v;
      renderLabel();
      close();
      if (opts.onChange) opts.onChange(v);
    });
    // 全局点击收起（只注册一次；点击组件内部由 stopPropagation/contains 放行）
    if (!customSelect._bound) {
      document.addEventListener('click', (e) => {
        if (activeSelect && !activeSelect._wrap.contains(e.target)) activeSelect.close();
      });
      customSelect._bound = true;
    }
    const api = {
      getValue: () => current,
      setValue(v) { current = v != null ? String(v) : ''; renderLabel(); },
      setOptions(o) {
        options.length = 0;
        (o || []).forEach((x) => options.push(typeof x === 'string' ? { value: x, label: x } : x));
        if (options.length && !options.some((x) => String(x.value) === current)) current = '';
        renderLabel(); renderList();
      },
      close,
      destroy: close,
      _wrap: wrap,
    };
    wrap.__cs = api;
    renderLabel();
    return api;
  }

  return { formatSize, formatTime, escapeHtml, extOf, getFileIcon, openModal, closeModal, confirm, toast, createSpeedTracker, formatProgress, initialsPicker, customSelect };
})();

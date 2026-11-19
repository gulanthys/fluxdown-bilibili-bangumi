// Account library browser. runtime.js supplies the authenticated API helpers.
var biliLibrarySources = ['history', 'favorites', 'likes', 'collections'];
var biliLibraryStrings = {
  en: {
    history: 'Watch history', favorites: 'Favorites', likes: 'Liked videos', collections: 'Creator collections',
    untitled: 'Untitled video', user: 'Bilibili user', unnamedFolder: 'Unnamed folder', collection: 'Collection', series: 'Series',
    needsLogin: 'Sign in to Bilibili or configure a cookie first.', invalidLogin: 'Your Bilibili session is no longer valid. Sign in again.',
    noResults: 'No downloadable videos on this page.', loadError: 'Could not load content: {detail}',
    created: 'Tasks created: {count}.', failed: 'Failed: {count}. Only failed items will be retried.', deferred: 'Not attempted: {count}. These items are still selected.',
    submitted: 'Added to the download queue: {url}', submitError: 'Could not add download: {detail}',
    inputEmpty: 'Enter a Bilibili link or a BV, AV, EP, or SS ID.',
    partInvalid: 'The Bilibili video part number is invalid.',
    inputInvalid: 'Unrecognized Bilibili content. Enter a BV, AV, EP, or SS ID, a Bilibili link, or shared text.',
    submit: 'Add a Bilibili download', placeholder: 'Paste a link or shared text, or enter a BV, AV, EP, or SS ID',
    queue: 'Add to download queue', title: 'Bilibili library', account: '{name} (UID {uid})', accountRequired: 'Sign in to browse your account content.',
    creatorInput: 'Creator UID (leave blank to use your own)', findCollections: 'Find collections', prevCollections: 'Previous collections', nextCollections: 'Next collections',
    loading: 'Loading…', refresh: 'Refresh', historyPager: 'History', page: 'Page {page}', next: 'Next page', reading: 'Loading from Bilibili…',
    enqueueing: 'Adding tasks…', enqueue: 'Add selected to queue', selection: 'Selected: {count}',
    queued: 'In download queue', unselect: 'Deselect', select: 'Select', invalidUid: 'The creator UID must be a positive integer.',
  },
  zh: {
    history: '观看历史', favorites: '收藏夹', likes: '点赞视频', collections: 'UP 主合集',
    untitled: '未命名视频', user: 'Bilibili 用户', unnamedFolder: '未命名收藏夹', collection: '合集', series: '系列',
    needsLogin: '请先登录 Bilibili 或配置 Cookie。', invalidLogin: 'Bilibili 登录状态无效，请重新登录。',
    noResults: '此页没有可下载的视频。', loadError: '加载失败：{detail}',
    created: '已创建 {count} 个任务。', failed: '失败 {count} 个，仅重试失败项。', deferred: '另有 {count} 项未尝试，仍保留在选择中。',
    submitted: '已加入待下载：{url}', submitError: '添加下载失败：{detail}',
    inputEmpty: '请输入 Bilibili 链接或 BV / AV / EP / SS 编号。',
    partInvalid: 'Bilibili 视频分 P 参数非法。',
    inputInvalid: '无法识别 Bilibili 内容。请输入 BV / AV / EP / SS 编号、Bilibili 链接或分享文案。',
    submit: '添加 Bilibili 下载', placeholder: '粘贴链接或分享文案，也可输入 BV / AV / EP / SS 编号',
    queue: '加入待下载', title: 'Bilibili 账户内容', account: '{name}（UID {uid}）', accountRequired: '读取账户内容需要有效登录。',
    creatorInput: 'UP 主 UID（留空使用当前账号）', findCollections: '查找合集', prevCollections: '上一页合集', nextCollections: '下一页合集',
    loading: '加载中…', refresh: '刷新', historyPager: '历史游标分页', page: '第 {page} 页', next: '下一页', reading: '正在读取 Bilibili…',
    enqueueing: '加入中…', enqueue: '将选中项加入下载', selection: '已选 {count} 项',
    queued: '已加入下载', unselect: '取消选择', select: '选择', invalidUid: 'UP 主 UID 必须是正整数。',
  },
};

function biliLibraryError(key) {
  return Object.assign(new Error(key), { biliKey: key });
}

function biliLibraryErrorMessage(error, fallback) {
  return error && error.biliKey
    ? { key: error.biliKey }
    : { key: fallback, params: { detail: String(error && error.message || error) } };
}

function biliLibraryQuery(values) {
  return Object.keys(values).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key]));
  }).join('&');
}

function biliLibraryText(value) {
  return String(value == null ? '' : value);
}

function biliLibraryNormalizeVideo(raw, fallback) {
  var row = raw || {};
  var bvid = String(row.bvid || row.bv_id || '');
  var aid = row.aid || row.id || (row.business === 'archive' ? row.oid : '') || '';
  var epid = row.epid || row.ep_id || (row.business === 'pgc' ? row.oid : '') || '';
  var url = '';
  try {
    if (epid) url = normalizeBiliInput('ep' + epid);
    else if (bvid) url = normalizeBiliInput(bvid);
    else if (aid) url = normalizeBiliInput('av' + aid);
  } catch (error) {}
  if (!url) return null;
  var page = Number(row.page);
  if (/\/video\//.test(url)) url += '?p=' + (Number.isSafeInteger(page) && page > 0 ? page : 1);
  return {
    url: url,
    title: biliLibraryText(row.title || row.name || fallback),
    owner: biliLibraryText((row.owner && row.owner.name) || (row.upper && row.upper.name) || row.author || ''),
  };
}

async function biliLibraryGetUser(state) {
  var cookie = await effectiveCookie(state.ctx);
  if (!cookie) throw biliLibraryError('needsLogin');
  var nav = await apiGet('/x/web-interface/nav', state.ctx, cookie);
  if (!nav || !nav.isLogin || !(nav.mid || nav.id)) throw biliLibraryError('invalidLogin');
  state.cookie = cookie;
  state.uid = String(nav.mid || nav.id);
  state.accountName = biliLibraryText(nav.uname);
}

async function biliLibraryFolders(state) {
  var data = await apiGet('/x/v3/fav/folder/created/list-all?up_mid=' + encodeURIComponent(state.uid), state.ctx, state.cookie);
  var rows = data && (data.list || data.folders) || [];
  state.folders = rows.map(function (item) {
    return { id: String(item.id || item.media_id || ''), title: biliLibraryText(item.title) };
  }).filter(function (item) { return item.id; });
  if (!state.folderId || !state.folders.some(function (item) { return item.id === state.folderId; })) {
    state.folderId = state.folders.length ? state.folders[0].id : '';
  }
}

async function biliLibraryCollections(state) {
  var mid = state.collectionMid || state.uid;
  var query = biliLibraryQuery({ mid: mid, page_num: state.collectionPage, page_size: 20, web_location: '333.1387' });
  var data = await apiGet('/x/polymer/web-space/seasons_series_list?' + query, state.ctx, state.cookie);
  var listing = data.items_lists || data;
  var seasons = listing.seasons_list || [];
  var series = listing.series_list || [];
  state.moreCollections = state.collectionPage * 20 < Number(listing.page && listing.page.total || 0);
  state.collections = [];
  seasons.forEach(function (item) {
    var id = item.meta && item.meta.season_id || item.season_id || item.id;
    if (id) state.collections.push({ id: 'season:' + id, title: biliLibraryText(item.meta && item.meta.name || item.name || item.title) });
  });
  series.forEach(function (item) {
    var id = item.meta && item.meta.series_id || item.series_id || item.id;
    if (id) state.collections.push({ id: 'series:' + id, title: biliLibraryText(item.meta && item.meta.name || item.name || item.title) });
  });
  if (!state.collectionId || !state.collections.some(function (item) { return item.id === state.collectionId; })) {
    state.collectionId = state.collections.length ? state.collections[0].id : '';
  }
}

async function biliLibraryFetch(state) {
  var data, rows = [];
  if (state.source === 'history') {
    var cursor = state.historyCursor || { max: 0, view_at: 0, business: '' };
    var path = '/x/web-interface/history/cursor?' + biliLibraryQuery({ type: 'archive', ps: 20, max: cursor.max, view_at: cursor.view_at, business: cursor.business || '' });
    data = await apiGet(path, state.ctx, state.cookie);
    rows = data && data.list || [];
    state.nextCursor = data && data.cursor || null;
    state.hasNext = !!(rows.length && state.nextCursor && (state.nextCursor.max || state.nextCursor.view_at) &&
      (state.nextCursor.max !== cursor.max || state.nextCursor.view_at !== cursor.view_at));
    rows = rows.map(function (entry) {
      var hist = entry.history || {};
      if (hist.business !== 'archive' && hist.business !== 'pgc') return null;
      var arc = entry.arc || {};
      return biliLibraryNormalizeVideo(Object.assign({}, arc, hist, {
        bvid: hist.bvid || arc.bvid,
        aid: hist.oid || arc.aid,
        ep_id: hist.business === 'pgc' ? hist.oid : '',
        title: entry.title || arc.title,
        owner: arc.owner || entry.owner || { name: entry.author_name },
      }));
    });
  } else if (state.source === 'favorites') {
    if (!state.folderId) return [];
    data = await apiGet('/x/v3/fav/resource/list?' + biliLibraryQuery({ media_id: state.folderId, pn: state.page, ps: 20, keyword: '', order: 'mtime', type: 0, tid: 0 }), state.ctx, state.cookie);
    rows = data && data.medias || [];
    state.hasNext = !!(data && data.has_more);
    rows = rows.map(function (entry) { return biliLibraryNormalizeVideo(entry, entry.title); });
  } else if (state.source === 'likes') {
    data = await apiGet('/x/space/like/video?' + biliLibraryQuery({ vmid: state.uid, pn: state.page, ps: 20 }), state.ctx, state.cookie);
    rows = Array.isArray(data) ? data : (data.list || data.vlist || data.items || []);
    if (!Array.isArray(rows)) rows = [];
    state.hasNext = rows.length >= 20;
    rows = rows.map(function (entry) { return biliLibraryNormalizeVideo(entry, entry.title); });
  } else {
    if (!state.collectionId) return [];
    var split = state.collectionId.split(':');
    var collectionId = split[1];
    if (split[0] === 'season') {
      var query = biliLibraryQuery({ mid: state.collectionMid || state.uid, season_id: collectionId,
        page_num: state.page, page_size: 20, web_location: '333.1387' });
      data = await apiGet('/x/polymer/web-space/seasons_archives_list?' + query, state.ctx, state.cookie);
      rows = data.archives || [];
      state.hasNext = state.page * 20 < Number(data.page && data.page.total || 0);
    } else {
      data = await apiGet('/x/series/archives?' + biliLibraryQuery({ mid: state.collectionMid || state.uid, series_id: collectionId, only_normal: true, sort: 'desc', pn: state.page, ps: 20 }), state.ctx, state.cookie);
      rows = data && data.archives || [];
      state.hasNext = !!(data && data.page && state.page * Number(data.page.ps || 20) < Number(data.page.count || 0));
    }
    rows = rows.map(function (entry) { return biliLibraryNormalizeVideo(entry, entry.title); });
  }
  var seen = new Set();
  return rows.filter(function(item) {
    if (!item || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function biliLibraryLoad(state, reset) {
  if (state.busy) return;
  if (reset) {
    state.page = 1;
    state.historyCursor = { max: 0, view_at: 0, business: '' };
    state.nextCursor = null;
    state.items = [];
    state.hasNext = false;
  }
  state.busy = true;
  state.error = null;
  state.empty = false;
  state.ctx.refresh();
  try {
    if (state.source === 'collections' && state.collectionMid) {
      state.cookie = await effectiveCookie(state.ctx);
    } else if (!state.uid) {
      await biliLibraryGetUser(state);
    }
    if (state.source === 'favorites' && reset) await biliLibraryFolders(state);
    if (state.source === 'collections' && reset) await biliLibraryCollections(state);
    state.items = await biliLibraryFetch(state);
    state.empty = !state.items.length;
    return true;
  } catch (error) {
    state.error = biliLibraryErrorMessage(error, 'loadError');
  } finally {
    state.busy = false;
    state.ctx.refresh();
  }
}

function biliLibraryState(ctx) {
  return {
    ctx: ctx, source: 'history', busy: false, error: null, empty: false, accountName: '', uid: '', cookie: '',
    page: 1, hasNext: false, historyCursor: { max: 0, view_at: 0, business: '' }, nextCursor: null,
    folders: [], folderId: '', collections: [], collectionId: '', items: [], selected: {}, queued: {},
    enqueueBusy: false, enqueueResult: null, input: '', inputStatus: null, inputFailed: false,
    collectionInput: '', collectionMid: '', collectionPage: 1, moreCollections: false,
  };
}

async function biliLibraryPageNext(state) {
  if (!state.hasNext || state.busy) return;
  var page = state.page, cursor = state.historyCursor;
  if (state.source === 'history') state.historyCursor = state.nextCursor;
  else state.page++;
  if (!(await biliLibraryLoad(state, false))) {
    state.page = page;
    state.historyCursor = cursor;
    state.ctx.refresh();
  }
}

function biliLibraryToggle(state, url) {
  if (state.queued[url]) return;
  if (state.selected[url]) delete state.selected[url];
  else {
    var item = state.items.find(function (item) { return item.url === url; });
    if (item) state.selected[url] = item;
  }
}

async function biliLibraryEnqueue(state) {
  if (state.enqueueBusy) return;
  var pending = Object.keys(state.selected).filter(function (url) { return !state.queued[url]; });
  if (!pending.length) return;
  var deferred = Math.max(0, pending.length - 20);
  pending = pending.slice(0, 20);
  state.enqueueBusy = true;
  state.enqueueResult = null;
  state.ctx.refresh();
  var created = 0, failures = [];
  for (var i = 0; i < pending.length; i++) {
    var url = pending[i];
    try {
      await flux.tasks.create({ request: { url: url, startPaused: true } });
      state.queued[url] = true;
      delete state.selected[url];
      created++;
    } catch (error) {
      failures.push((state.selected[url].title || url) + ': ' + String(error && error.message || error));
    }
    state.ctx.refresh();
  }
  state.enqueueBusy = false;
  state.enqueueResult = { created: created, failed: failures.length, deferred: deferred };
  state.error = failures.length ? { detail: failures.join('\n') } : null;
  state.ctx.refresh();
}

async function biliLibrarySubmitInput(state, input, ctx) {
  state.input = input;
  try {
    var url = normalizeBiliInput(input);
    await flux.tasks.create({ request: { url: url, startPaused: true } });
    state.input = '';
    state.inputFailed = false;
    state.inputStatus = { key: 'submitted', params: { url: url } };
  } catch (error) {
    state.inputFailed = true;
    state.inputStatus = biliLibraryErrorMessage(error, 'submitError');
  }
  ctx.refresh();
}

function biliLibraryRender(state, ctx) {
  var locale = ctx && ctx.locale;
  function t(key, params) { return biliText(locale, biliLibraryStrings, key, params); }
  function status(message) { return message.key ? t(message.key, message.params) : message.detail; }
  var h = flux.ui.h;
  var controls = [];
  controls.push(h('section', { key: 'submit', title: t('submit') },
    h('textarea', { key: 'input', rows: 2, value: state.input, placeholder: t('placeholder') }),
    h('button', { key: 'submit-input', text: t('queue'), variant: 'primary' }),
    state.inputStatus ? h('text', { key: 'input-status', text: status(state.inputStatus), tone: state.inputFailed ? 'danger' : 'success' }) : null));
  controls.push(h('heading', { key: 'title', text: t('title'), level: 2 }));
  controls.push(h('text', { key: 'account', text: state.uid ? t('account', { name: state.accountName || t('user'), uid: state.uid }) : t('accountRequired'), tone: 'muted', size: 'sm' }));
  controls.push(h('stack', { key: 'sources', direction: 'row', gap: 'xs' }, biliLibrarySources.map(function (source) {
    return h('button', { key: 'source-' + source, text: t(source), variant: state.source === source ? 'primary' : 'outline', disabled: state.busy }, null);
  })));
  if (state.source === 'favorites' && state.folders.length) {
    controls.push(h('select', { key: 'folders', value: state.folderId, options: state.folders.map(function (folder) { return { value: folder.id, label: folder.title || t('unnamedFolder') }; }), disabled: state.busy }));
  }
  if (state.source === 'collections') {
    controls.push(h('stack', { key: 'up', direction: 'row', gap: 'xs' },
      h('input', { key: 'up-input', value: state.collectionInput, placeholder: t('creatorInput') }),
      h('button', { key: 'up-load', text: t('findCollections'), disabled: state.busy })));
    if (state.collections.length) {
      controls.push(h('stack', { key: 'collection-picker', direction: 'row', gap: 'xs' },
        h('button', { key: 'collections-prev', text: t('prevCollections'), disabled: state.busy || state.collectionPage <= 1 }),
        h('select', { key: 'collections', value: state.collectionId, options: state.collections.map(function (item) {
          return { value: item.id, label: item.title || t(item.id.indexOf('season:') === 0 ? 'collection' : 'series') };
        }), disabled: state.busy }),
        h('button', { key: 'collections-next', text: t('nextCollections'), disabled: state.busy || !state.moreCollections })));
    }
  }
  controls.push(h('stack', { key: 'pager', direction: 'row', gap: 'sm', align: 'center' },
    h('button', { key: 'refresh', text: t(state.busy ? 'loading' : 'refresh'), disabled: state.busy }, null),
    h('text', { key: 'page-number', text: state.source === 'history' ? t('historyPager') : t('page', { page: state.page }), tone: 'muted', size: 'sm' }),
    h('button', { key: 'next', text: t('next'), disabled: state.busy || !state.hasNext }, null)));
  if (state.busy) controls.push(h('text', { key: 'loading', text: t('reading'), tone: 'muted' }));
  if (state.error) controls.push(h('text', { key: 'error', text: status(state.error), tone: 'danger' }));
  if (state.empty) controls.push(h('text', { key: 'message', text: t('noResults'), tone: 'muted' }));
  var selectedCount = Object.keys(state.selected).length;
  controls.push(h('stack', { key: 'enqueue', direction: 'row', gap: 'sm', align: 'center' },
    h('button', { key: 'enqueue-button', text: t(state.enqueueBusy ? 'enqueueing' : 'enqueue'), variant: 'primary', disabled: state.enqueueBusy || !selectedCount }, null),
    h('text', { key: 'selection-count', text: t('selection', { count: selectedCount }), tone: 'muted', size: 'sm' })));
  if (state.enqueueResult) {
    var result = state.enqueueResult;
    var parts = [t('created', { count: result.created })];
    if (result.failed) parts.push(t('failed', { count: result.failed }));
    if (result.deferred) parts.push(t('deferred', { count: result.deferred }));
    controls.push(h('text', { key: 'enqueue-result', text: parts.join(biliLocale(locale) === 'zh' ? '' : ' '), tone: result.failed ? 'warning' : 'success' }));
  }
  state.items.forEach(function (item) {
    var chosen = !!state.selected[item.url];
    var queued = !!state.queued[item.url];
    controls.push(h('card', { key: 'media-' + encodeURIComponent(item.url) },
      h('stack', { gap: 'xs' },
        h('text', { key: 'media-title', text: item.title || t('untitled'), weight: 'medium' }),
        h('text', { key: 'media-owner', text: item.owner || item.url, tone: 'muted', size: 'sm' }),
        h('button', { key: 'toggle-' + encodeURIComponent(item.url), text: t(queued ? 'queued' : (chosen ? 'unselect' : 'select')), variant: chosen && !queued ? 'primary' : 'outline', disabled: queued }, null))));
  });
  return h('scroll', { key: 'scroll' }, h('stack', { gap: 'sm', padding: 'md' }, controls));
}

flux.ui.view('library', {
  async init(ctx) {
    var state = biliLibraryState(ctx);
    await biliLibraryLoad(state, true);
    return state;
  },
  render(state, ctx) { return biliLibraryRender(state, ctx); },
  async event(state, ev, ctx) {
    var node = String(ev.node || '').split('/').pop();
    if (node === 'input' && ev.type === 'change') { state.input = String(ev.value || ''); return; }
    if (node === 'submit-input' && ev.type === 'press') { await biliLibrarySubmitInput(state, state.input, ctx); return; }
    if (node === 'up-input' && ev.type === 'change') { state.collectionInput = String(ev.value || ''); return; }
    if ((node === 'up-load' && ev.type === 'press') || (node === 'up-input' && ev.type === 'submit')) {
      var mid = String(ev.type === 'submit' ? ev.value || '' : state.collectionInput).trim();
      if (mid && !/^[1-9]\d*$/.test(mid)) {
        state.error = { key: 'invalidUid' };
        ctx.refresh();
        return;
      }
      state.collectionMid = mid;
      state.collectionInput = mid;
      state.collectionId = '';
      state.collectionPage = 1;
      state.ctx = ctx;
      await biliLibraryLoad(state, true);
      return;
    }
    if (ev.type === 'press' && (node === 'collections-prev' || node === 'collections-next')) {
      if ((node === 'collections-prev' && state.collectionPage > 1) || (node === 'collections-next' && state.moreCollections)) {
        state.collectionPage += node === 'collections-prev' ? -1 : 1;
        state.ctx = ctx;
        await biliLibraryLoad(state, true);
      }
      return;
    }
    if (node.indexOf('source-') === 0 && ev.type === 'press') {
      var source = node.slice(7);
      if (biliLibrarySources.indexOf(source) >= 0) {
        state.source = source;
        state.folderId = '';
        state.collectionId = '';
        state.ctx = ctx;
        await biliLibraryLoad(state, true);
      }
      return;
    }
    if (node === 'refresh' && ev.type === 'press') { state.ctx = ctx; await biliLibraryLoad(state, true); return; }
    if (node === 'next' && ev.type === 'press') { state.ctx = ctx; await biliLibraryPageNext(state); return; }
    if (node === 'folders' && ev.type === 'change') {
      state.folderId = String(ev.value || ''); state.ctx = ctx; await biliLibraryLoad(state, true); return;
    }
    if (node === 'collections' && ev.type === 'change') {
      state.collectionId = String(ev.value || ''); state.ctx = ctx; await biliLibraryLoad(state, true); return;
    }
    if (node === 'enqueue-button' && ev.type === 'press') { state.ctx = ctx; await biliLibraryEnqueue(state); return; }
    if (node.indexOf('toggle-') === 0 && ev.type === 'press') {
      var encoded = node.slice(7), url;
      try { url = decodeURIComponent(encoded); } catch (error) { return; }
      biliLibraryToggle(state, url);
      ctx.refresh();
    }
  },
});

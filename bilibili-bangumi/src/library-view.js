// Account library browser. runtime.js supplies the authenticated API helpers.
var biliLibrarySources = ['history', 'favorites', 'likes', 'collections'];
// Leave room under the host's 128-image quota for the avatar and the next request.
var biliLibraryCoverLimit = 100;
var biliLibraryItemLimit = 400;
// Transparent 32×34 PNG: the Bilibili TV mark, independent of network access.
var biliLibraryLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAiCAYAAAA+stv/AAAA0ElEQVR42u2XwQ3EMAgE6WxLo6NrwQ1dD8nnIuURmwVjGUX34AfsJMZgRD5f2Wp/AMPh+FlUwI4nE7SAeMsAQBDiLo7ZGrhDKOGvtLijCNmkXliRxN8aOy7iS7IMLMAK8T6EIY6EZjPOuVjczv3QdLLFexBdACzs/WAAVg+gMIASPkwTcgPow3Wyko9AXABMQi9wCEADZ60ZAKWKcHRdEYifBrimXiMLlAaAczR7RjDViFgITPgfJYfR9nFc4kFS4kk2U2j+uOqb0fbd8P3r+Qn0tdS2sZm1AQAAAABJRU5ErkJggg==';
var biliLibraryStrings = {
  en: {
    history: 'Watch history', favorites: 'Favorites', likes: 'Liked videos', collections: 'Creator collections',
    untitled: 'Untitled video', user: 'Bilibili user', unnamedFolder: 'Unnamed folder', collection: 'Collection', series: 'Series',
    needsLogin: 'Sign in to Bilibili or configure a cookie first.', invalidLogin: 'Your Bilibili session is no longer valid. Sign in again.',
    noResults: 'No downloadable videos.', loadError: 'Could not load content: {detail}',
    created: 'Tasks created: {count}.', failed: 'Failed: {count}. Only failed items will be retried.', deferred: 'Not attempted: {count}. These items are still selected.',
    uid: 'UID {uid}', accountRequired: 'Sign in to browse your account content.',
    folder: 'Folder', chooseCollection: 'Choose a collection', noCollections: 'No collections found.',
    creatorInput: 'Creator UID (leave blank to use your own)', findCollections: 'Find collections', moreCollections: 'More collections',
    refresh: 'Refresh', more: 'Load more videos', reading: 'Loading from Bilibili…',
    limit: 'Showing the first {count} videos in this view.',
    enqueueing: 'Adding tasks…', enqueue: 'Add to queue ({count})',
    outside: '{count} outside this list', review: 'View selected', back: 'Back to browsing', remove: 'Remove',
    watched: 'Watched {time}', complete: 'Watched', part: 'Part {number}', episode: 'Episode',
    queued: 'In download queue', invalidUid: 'The creator UID must be a positive integer.',
  },
  zh: {
    history: '观看历史', favorites: '收藏夹', likes: '点赞视频', collections: 'UP 主合集',
    untitled: '未命名视频', user: 'Bilibili 用户', unnamedFolder: '未命名收藏夹', collection: '合集', series: '系列',
    needsLogin: '请先登录 Bilibili 或配置 Cookie。', invalidLogin: 'Bilibili 登录状态无效，请重新登录。',
    noResults: '没有可下载的视频。', loadError: '加载失败：{detail}',
    created: '已创建 {count} 个任务。', failed: '失败 {count} 个，仅重试失败项。', deferred: '另有 {count} 项未尝试，仍保留在选择中。',
    uid: 'UID {uid}', accountRequired: '登录后可浏览账户内容。',
    folder: '收藏夹', chooseCollection: '选择合集', noCollections: '没有找到合集。',
    creatorInput: 'UP 主 UID（留空使用当前账号）', findCollections: '查找合集', moreCollections: '更多合集',
    refresh: '刷新', more: '加载更多视频', reading: '正在读取 Bilibili…',
    limit: '此处最多显示前 {count} 条视频。',
    enqueueing: '加入中…', enqueue: '加入待下载（{count}）',
    outside: '另有 {count} 项不在此列表', review: '查看已选', back: '返回浏览', remove: '移除',
    watched: '已看 {time}', complete: '已看完', part: '第 {number} P', episode: '番剧',
    queued: '已加入待下载', invalidUid: 'UP 主 UID 必须是正整数。',
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

function biliLibraryDuration(value) {
  if (typeof value === 'string' && /^\d{1,4}:\d{2}(?::\d{2})?$/.test(value)) return value;
  var seconds = Math.floor(Number(value));
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return '';
  var hh = Math.floor(seconds / 3600);
  var mm = Math.floor(seconds / 60) % 60;
  return (hh ? hh + ':' : '') + String(mm).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function biliLibraryDate(value) {
  var seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return '';
  var date = new Date(seconds * 1000);
  if (isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

async function biliLibraryImage(ctx, url, width, height, circle) {
  var source = String(url || '').replace(/^\/\//, 'https://').replace(/^http:\/\//i, 'https://');
  if (!ctx.images || !/^https:\/\/i[0-3]\.hdslb\.com\//i.test(source)) return '';
  var options = { url: source, maxWidth: width, maxHeight: height };
  try {
    var shape = circle ? { circle: true } : { cornerRadius: 12 };
    try {
      return await ctx.images.load(Object.assign(shape, options));
    } catch (error) {
      if (!/unknown field [`'"](?:circle|cornerRadius)\b/.test(String(error))) return '';
    }
    return await ctx.images.load(options);
  } catch (error) {
    // Artwork is optional; don't block browsing when a CDN image is unavailable.
    return '';
  }
}

async function biliLibraryCovers(state, items) {
  var previous = state.covers;
  var recent = items.slice(-biliLibraryCoverLimit);
  var covers = await Promise.all(recent.map(function (item) {
    return previous.has(item.url) ? previous.get(item.url) : biliLibraryImage(state.ctx, item.cover, 192, 108);
  }));
  state.covers = new Map(recent.map(function (item, i) { return [item.url, covers[i]]; }));
  var retained = new Set(covers);
  retained.add(state.avatar);
  var expired = Array.from(new Set(previous.values())).filter(function (src) { return src && !retained.has(src); });
  await Promise.allSettled(expired.map(function (src) { return state.ctx.images.release(src); }));
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
    cover: biliLibraryText(row.cover || row.pic || row.cover_url || (row.covers || [])[0]),
    duration: biliLibraryDuration(row.duration || row.length),
    date: biliLibraryDate(row.view_at || row.fav_time || row.pubdate || row.created || row.ctime),
    progress: row.progress === -1 ? -1 : biliLibraryDuration(row.progress),
    part: biliLibraryText(row.show_title || row.part),
    page: page > 1 && Number.isSafeInteger(page) ? page : 0,
    episode: !!epid,
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
  state.avatar = await biliLibraryImage(state.ctx, nav.face, 72, 72, true);
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

async function biliLibraryCollections(state, page) {
  var mid = state.collectionMid || state.uid;
  var query = biliLibraryQuery({ mid: mid, page_num: page, page_size: 20, web_location: '333.1387' });
  var data = await apiGet('/x/polymer/web-space/seasons_series_list?' + query, state.ctx, state.cookie);
  var listing = data.items_lists || data;
  var seasons = listing.seasons_list || [];
  var series = listing.series_list || [];
  state.collectionPage = page;
  state.moreCollections = page * 20 < Number(listing.page && listing.page.total || 0);
  if (page === 1) state.collections = [];
  var existing = new Set(state.collections.map(function (item) { return item.id; }));
  function add(kind, item) {
    var meta = item.meta || {};
    var numericId = meta[kind + '_id'] || item[kind + '_id'] || item.id;
    if (!numericId) return;
    var id = kind + ':' + numericId;
    if (existing.has(id)) return;
    existing.add(id);
    state.collections.push({ id: id, title: biliLibraryText(meta.name || item.name || item.title) });
  }
  seasons.forEach(function (item) { add('season', item); });
  series.forEach(function (item) { add('series', item); });
  if (!state.collectionId || !state.collections.some(function (item) { return item.id === state.collectionId; })) {
    state.collectionId = state.collections.length ? state.collections[0].id : '';
  }
}

async function biliLibraryFetch(state) {
  var data, rows = [];
  if (state.source === 'history') {
    var cursor = state.nextCursor || { max: 0, view_at: 0, business: '' };
    var path = '/x/web-interface/history/cursor?' + biliLibraryQuery({ type: 'archive', ps: 20, max: cursor.max, view_at: cursor.view_at, business: cursor.business || '' });
    data = await apiGet(path, state.ctx, state.cookie);
    rows = data && data.list || [];
    state.nextCursor = data && data.cursor || null;
    state.hasNext = !!(rows.length && state.nextCursor && (state.nextCursor.max || state.nextCursor.view_at) &&
      (state.nextCursor.max !== cursor.max || state.nextCursor.view_at !== cursor.view_at ||
        (state.nextCursor.business || '') !== (cursor.business || '')));
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
        cover: entry.cover || (entry.covers || [])[0] || arc.pic,
        duration: entry.duration || arc.duration,
        view_at: entry.view_at,
        progress: entry.progress,
        show_title: entry.show_title || entry.long_title,
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

async function biliLibraryLoad(state, reset, keepFilters) {
  if (state.busy) return;
  if (reset) {
    state.page = 1;
    state.listRevision++;
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
    if (reset && !keepFilters) {
      if (state.source === 'favorites') await biliLibraryFolders(state);
      if (state.source === 'collections') await biliLibraryCollections(state, 1);
    }
    var items = await biliLibraryFetch(state);
    if (!reset && state.items.length) {
      var seen = new Set(state.items.map(function (item) { return item.url; }));
      items = state.items.concat(items.filter(function (item) { return !seen.has(item.url); }));
    }
    state.items = items.slice(0, biliLibraryItemLimit);
    state.empty = !state.items.length;
    await biliLibraryCovers(state, state.items);
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
    ctx: ctx, source: 'history', busy: false, error: null, empty: false, accountName: '', uid: '', cookie: '', avatar: '',
    page: 1, hasNext: false, listRevision: 0, nextCursor: null,
    folders: [], folderId: '', collections: [], collectionId: '', items: [], covers: new Map(), selected: {}, queued: {},
    enqueueBusy: false, enqueueResult: null, enqueueError: '', reviewing: false,
    collectionInput: '', collectionMid: '', collectionPage: 1, moreCollections: false,
  };
}

async function biliLibraryMore(state) {
  if (state.busy || !state.hasNext || state.items.length >= biliLibraryItemLimit) return;
  state.page++;
  if (!(await biliLibraryLoad(state, false))) {
    state.page--;
    state.ctx.refresh();
  }
}

function biliLibrarySelect(state, url, checked) {
  if (state.enqueueBusy || state.queued[url]) return;
  if (!checked) delete state.selected[url];
  else {
    var item = state.items.find(function (item) { return item.url === url; });
    if (item) state.selected[url] = item;
  }
  if (!Object.keys(state.selected).length) state.reviewing = false;
}

async function biliLibraryEnqueue(state) {
  if (state.enqueueBusy) return;
  var pending = Object.keys(state.selected).filter(function (url) { return !state.queued[url]; });
  if (!pending.length) return;
  var deferred = Math.max(0, pending.length - 20);
  pending = pending.slice(0, 20);
  state.enqueueBusy = true;
  state.enqueueResult = null;
  state.enqueueError = '';
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
  state.enqueueError = failures.join('\n');
  if (!Object.keys(state.selected).length) state.reviewing = false;
  state.ctx.refresh();
}


function biliLibraryRender(state, ctx) {
  var locale = ctx && ctx.locale;
  function t(key, params) { return biliText(locale, biliLibraryStrings, key, params); }
  var h = flux.ui.h;
  var selected = Object.keys(state.selected);
  var outside = selected.length - state.items.filter(function (item) { return state.selected[item.url]; }).length;
  var actions = selected.length > 0 && h('stack', { key: 'batch', direction: 'row', gap: 'xs', align: 'center', wrap: true },
    outside > 0 && h('badge', { key: 'outside-count', text: t('outside', { count: outside }), tone: 'muted' }),
    h('button', { key: 'review', text: t(state.reviewing ? 'back' : 'review'), variant: 'ghost' }),
    h('button', { key: 'enqueue-button', text: state.enqueueBusy ? t('enqueueing') : t('enqueue', { count: selected.length }),
      variant: 'primary', disabled: state.enqueueBusy }));
  var filters = [];
  if (state.source === 'favorites' && state.folders.length) {
    filters.push(h('text', { key: 'folder-label', text: t('folder'), tone: 'muted' }),
      h('select', { key: 'folders', value: state.folderId, options: state.folders.map(function (folder) {
        return { value: folder.id, label: folder.title || t('unnamedFolder') };
      }), disabled: state.busy }));
  }
  if (state.source === 'collections') {
    filters.push(h('input', { key: 'up-input', value: state.collectionInput, placeholder: t('creatorInput'), disabled: state.busy }),
      h('button', { key: 'up-load', text: t('findCollections'), disabled: state.busy }));
    if (state.collections.length) {
      filters.push(h('select', { key: 'collections', value: state.collectionId, placeholder: t('chooseCollection'),
        options: state.collections.map(function (item) {
          return { value: item.id, label: item.title || t(item.id.indexOf('season:') === 0 ? 'collection' : 'series') };
        }), disabled: state.busy }));
    }
    if (state.moreCollections) {
      filters.push(h('button', { key: 'collections-more', text: t('moreCollections'), disabled: state.busy }));
    }
  }
  var refresh = h('button', { key: 'refresh', text: t('refresh'), variant: 'ghost', disabled: state.busy });
  var rows = (state.reviewing ? selected.map(function (url) { return state.selected[url]; }) : state.items).map(function (item) {
    var key = encodeURIComponent(item.url);
    var cover = state.covers.get(item.url);
    var queued = !!state.queued[item.url];
    var part = item.part || (item.page ? t('part', { number: item.page }) : item.episode ? t('episode') : '');
    var watched = item.progress === -1 ? t('complete') : item.progress ? t('watched', { time: item.progress }) : '';
    var secondary = [item.owner, part === item.title ? '' : part, watched].filter(Boolean).join(' · ');
    return h('stack', { key: 'media-' + key, direction: 'row', gap: 'md', align: 'center', padding: 'xs' },
      !state.reviewing && h('checkbox', { key: 'toggle-' + key, checked: !!state.selected[item.url], disabled: queued || state.enqueueBusy }),
      cover ? h('image', { key: 'cover', src: cover, width: 96, height: 54 })
        : h('image', { key: 'missing-cover', src: biliLibraryLogo, width: 96, height: 54 }),
      h('stack', { grow: true, gap: 'xs' },
        h('text', { key: 'media-title', text: item.title || t('untitled'), weight: 'semibold', truncate: true }),
        secondary ? h('text', { key: 'media-details', text: secondary, tone: 'muted', size: 'sm', truncate: true }) : null),
      (item.duration || item.date) ? h('stack', { key: 'media-meta', gap: 'xs', align: 'end' },
        item.duration ? h('text', { key: 'media-duration', text: item.duration, weight: 'medium' }) : null,
        item.date ? h('text', { key: 'media-date', text: item.date, tone: 'muted', size: 'xs' }) : null) : null,
      state.reviewing && h('button', { key: 'remove-' + key, text: t('remove'), variant: 'ghost', disabled: state.enqueueBusy }),
      queued && h('badge', { key: 'queued', text: t('queued'), tone: 'success' }));
  });
  var result = state.enqueueResult;
  var parts = result ? [t('created', { count: result.created })] : [];
  if (result && result.failed) parts.push(t('failed', { count: result.failed }));
  if (result && result.deferred) parts.push(t('deferred', { count: result.deferred }));
  return h('stack', { key: 'library', gap: 'sm', padding: 'md', grow: true },
    h('stack', { key: 'header', direction: 'row', justify: 'between', align: 'center', wrap: true },
      h('stack', { direction: 'row', align: 'center' },
        h('image', { key: 'logo', src: biliLibraryLogo, width: 32, height: 34 }),
        h('heading', { key: 'title', text: 'Bilibili', level: 1 })),
      state.uid ? h('stack', { key: 'account', direction: 'row', align: 'center' },
        state.avatar ? h('image', { key: 'avatar', src: state.avatar, width: 36, height: 36 }) : null,
        h('stack', { gap: 'xs' },
          h('text', { key: 'account-name', text: state.accountName || t('user'), weight: 'semibold' }),
          h('text', { key: 'account-uid', text: t('uid', { uid: state.uid }), tone: 'muted', size: 'xs' })))
        : h('text', { key: 'account-required', text: t('accountRequired'), tone: 'muted' })),
    h('stack', { key: 'navigation', direction: 'row', align: 'center', justify: 'between', wrap: true },
      state.reviewing ? h('heading', { key: 'review-title', text: t('review'), level: 2 }) :
        h('tabs', { key: 'sources', value: state.source, items: biliLibrarySources.map(function (source) {
          return { value: source, label: t(source) };
        }) }),
      h('stack', { direction: 'row', align: 'center', wrap: true },
        !state.reviewing && refresh, actions)),
    !state.reviewing && filters.length > 0 && h('stack', { key: 'filters', direction: 'row', wrap: true, align: 'center' }, filters),
    result && h('text', { key: 'enqueue-result', text: parts.join(biliLocale(locale) === 'zh' ? '' : ' '), tone: result.failed ? 'warning' : 'success' }),
    state.enqueueError ? h('callout', { key: 'enqueue-error', text: state.enqueueError, tone: 'danger' }) : null,
    h('divider', { key: 'list-top' }),
    h('scroll', { key: state.reviewing ? 'review-rows' : 'browse-' + state.listRevision },
      rows.length > 0 && h('stack', { key: 'rows', gap: 'sm' }, rows),
      !state.reviewing && state.error && h('callout', { key: 'error', text: t(state.error.key, state.error.params), tone: 'danger' }),
      !state.reviewing && state.empty && !state.busy && h('empty', { key: 'message',
        title: t(state.source === 'collections' && !state.collections.length ? 'noCollections' : 'noResults') }),
      !state.reviewing && (state.busy || state.hasNext) && h('stack', { key: 'list-end', align: 'center', padding: 'md' },
        state.busy ? h('spinner', { key: 'loading', label: t('reading') })
          : state.items.length < biliLibraryItemLimit ? h('button', { key: 'more', text: t('more') })
          : h('text', { key: 'list-limit', text: t('limit', { count: biliLibraryItemLimit }), tone: 'muted' }))));
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
    if (state.busy) return;
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
      state.ctx = ctx;
      await biliLibraryLoad(state, true);
      return;
    }
    if (ev.type === 'press' && node === 'collections-more' && state.moreCollections) {
      state.busy = true;
      state.error = null;
      state.ctx = ctx;
      ctx.refresh();
      try {
        await biliLibraryCollections(state, state.collectionPage + 1);
      } catch (error) {
        state.error = biliLibraryErrorMessage(error, 'loadError');
      } finally {
        state.busy = false;
        ctx.refresh();
      }
      return;
    }
    if (node === 'sources' && ev.type === 'change') {
      if (biliLibrarySources.indexOf(ev.value) >= 0 && ev.value !== state.source) {
        state.source = ev.value;
        state.ctx = ctx;
        await biliLibraryLoad(state, true);
      }
      return;
    }
    if (node === 'refresh' && ev.type === 'press') {
      state.ctx = ctx;
      await biliLibraryLoad(state, true);
      return;
    }
    if (node === 'more' && ev.type === 'press') {
      state.ctx = ctx; await biliLibraryMore(state); return;
    }
    if (node === 'folders' && ev.type === 'change') {
      state.folderId = String(ev.value || ''); state.ctx = ctx; await biliLibraryLoad(state, true, true); return;
    }
    if (node === 'collections' && ev.type === 'change') {
      state.collectionId = String(ev.value || ''); state.ctx = ctx; await biliLibraryLoad(state, true, true); return;
    }
    if (node === 'enqueue-button' && ev.type === 'press') { state.ctx = ctx; await biliLibraryEnqueue(state); return; }
    if (node === 'review' && ev.type === 'press') {
      state.reviewing = !state.reviewing;
      ctx.refresh();
      return;
    }
    var toggle = node.indexOf('toggle-') === 0 && ev.type === 'change';
    var remove = node.indexOf('remove-') === 0 && ev.type === 'press';
    if (toggle || remove) {
      var url;
      try { url = decodeURIComponent(node.slice(7)); } catch (error) { return; }
      biliLibrarySelect(state, url, toggle && ev.value === true);
      ctx.refresh();
    }
  },
});

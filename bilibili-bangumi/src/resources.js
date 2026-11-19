// Manifest tokens contain only stable media identifiers, never expiring URLs.
var RESOURCE_KINDS = new Set(['cover', 'danmakuXml']);

function resourceName(value) {
  return sanitizeFileName(String(value || 'Bilibili'));
}

function resourceUrl(value) {
  var url = String(value || '').replace(/^(?:http:)?\/\//i, 'https://');
  return /^https:\/\/(?:[a-z0-9-]+\.)*(?:bilibili\.com|hdslb\.com|bilivideo\.com|bilivideo\.cn|biliapi\.net)(?:[/?][^\x00-\x20\\]*|$)/i.test(url) ? url : '';
}

function resourceImageExtension(url) {
  return (/\.(jpe?g|png|webp|avif)(?:[?#@]|$)/i.exec(url) || ['', 'jpg'])[1].toLowerCase();
}

function resourceManifestItem(media, kind, name) {
  return { id: 'resource:' + kind + ':' + media.id, name: name, path: media.path || '', size: 0, kind: 'file' };
}

async function resourceMediaFromId(ctx, cookie) {
  var token = /^resource:([^:]+):(?:(ep):([1-9]\d*)|video:(BV[0-9a-z]+):cid:([1-9]\d*))$/i.exec(String(ctx.resolverItem || ''));
  if (!token || !RESOURCE_KINDS.has(token[1])) throw new Error('Bilibili 附加资源标识无效');
  var media;
  if (token[2]) {
    var epId = token[3];
    var season = await apiGet('/pgc/view/web/season?ep_id=' + epId, ctx, cookie);
    var episode = findEpisode(season, epId);
    if (!episode) throw new Error('Bilibili 未返回附加资源所属分集');
    media = { bvid: episode.bvid || episode.bv_id, cid: episode.cid, aid: episode.aid,
      title: episodeDisplayName(season, epId, episode), cover: episode.cover || season.cover };
  } else {
    var bvid = token[4], cid = token[5];
    var view = await apiGet('/x/web-interface/view?bvid=' + encodeURIComponent(bvid), ctx, cookie);
    var pages = Array.isArray(view.pages) ? view.pages : [];
    var index = pages.findIndex(function(page) { return page && String(page.cid) === cid; });
    var title = view.title || bvid;
    if (index >= 0 && pages.length > 1) title += ' - P' + (index + 1) + ' ' + String(pages[index].part || '');
    media = { bvid: bvid, cid: cid, aid: view.aid, title: title, cover: (index >= 0 && pages[index].first_frame) || view.pic };
  }
  return { media: media, kind: token[1] };
}

async function listBiliResources(ctx, media, cookie, kinds) {
  var selected = new Set(kinds), items = [];
  var label = resourceName(media.title), image = resourceUrl(media.cover);
  if (selected.has('cover') && image) {
    items.push(resourceManifestItem(media, 'cover', label + ' - 封面.' + resourceImageExtension(image)));
  }
  if (media.cid) {
    if (selected.has('danmakuXml')) items.push(resourceManifestItem(media, 'danmakuXml', label + ' - 弹幕.xml'));
  }
  return items;
}

function resourceDownloadHeaders() {
  return { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT };
}

async function resolveBiliResource(ctx) {
  var cookie = await effectiveCookie(ctx);
  var resolved = await resourceMediaFromId(ctx, cookie);
  var media = resolved.media, kind = resolved.kind, name = resourceName(media.title);
  if (kind === 'cover') {
    var cover = resourceUrl(media.cover);
    if (!cover) throw new Error('Bilibili 封面已不可用');
    return { url: cover, fileName: name + ' - 封面.' + resourceImageExtension(cover), extraHeaders: resourceDownloadHeaders() };
  }
  if (!/^[1-9]\d*$/.test(String(media.cid))) throw new Error('Bilibili 弹幕缺少 CID');
  return { url: 'https://comment.bilibili.com/' + media.cid + '.xml',
    fileName: name + ' - 弹幕.xml', extraHeaders: resourceDownloadHeaders() };
}

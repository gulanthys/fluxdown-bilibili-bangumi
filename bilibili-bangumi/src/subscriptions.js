// 订阅轮询会直接为条目建任务，单次只解析最近一批分集，避免长篇番剧或大量番外
// 让一次订阅调用超过宿主的墙钟预算。核心会保留已知 guid，后续轮询继续尝试最新分集。
function subscriptionOptions(kind) {
  var quality = setting('quality', 'best');
  if (quality === 'audio') quality = 'best';
  if (typeof quality !== 'string' || !/^(best|2160|1440|1080|720|480)$/.test(quality)) {
    throw new Error('插件默认画质必须是 best、2160、1440、1080、720 或 480');
  }
  var includeExtras = setting('includeExtras', false);
  var highestQualityOnly = setting('highestQualityOnly', false);
  if (typeof includeExtras !== 'boolean' || typeof highestQualityOnly !== 'boolean') {
    throw new Error('插件的番外和最高画质设置必须是 boolean');
  }
  return {
    quality: quality,
    includeExtras: includeExtras,
    highestQualityOnly: highestQualityOnly,
    limit: kind === 'uploader' ? 20 : MAX_SUBSCRIPTION_EPISODES,
  };
}

function subscriptionQualityCandidates(play, title, highestQualityOnly, quality) {
  var candidates = [];
  var variants = buildManifestVariantsFromPlay(play, title);
  var ceiling = quality && quality !== 'best' ? Number(quality) : 0;
  if (ceiling) variants = variants.filter(function(variant) { return Number(variant.height) <= ceiling; });
  variants = selectListedQualityVariants(variants, Boolean(highestQualityOnly || ceiling));
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i] || {};
    var qualityId = Number(variant.qualityId) || 0;
    var height = Number(variant.height) || 0;
    if (!qualityId || !height) continue;
    candidates.push({
      qualityId: qualityId,
      height: height,
      label: variant.label,
      totalBytes: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
    });
  }
  return candidates;
}
var MAX_SUBSCRIPTION_EPISODES = 50;

function subscriptionItemTitle(seriesTitle, name, variant) {
  var label = String(variant && variant.label || '').trim();
  if (!label || label === 'quality-unknown') {
    var height = Number(variant && variant.height) || 0;
    label = height ? height + 'p' : 'unknown-quality';
    var qualityId = Number(variant && variant.qualityId) || 0;
    if (qualityId) label += ' [qn' + qualityId + ']';
  }
  var sourceName = String(variant && variant.fileName || '');
  var extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(sourceName);
  var extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'mp4';
  return sanitizeFileName(seriesTitle + ' - ' + name + ' [' + label + '].' + extension);
}

function subscriptionEpisodeGroups(result, includeExtras) {
  var groups = [];
  if (Array.isArray(result.episodes)) groups.push({ title: '正片', episodes: filterBangumiEpisodes(result.episodes, includeExtras) });
  if (includeExtras && Array.isArray(result.section)) {
    for (var i = 0; i < result.section.length; i++) {
      var section = result.section[i];
      if (section && Array.isArray(section.episodes)) {
        groups.push({ title: section.title || '番外', episodes: section.episodes });
      }
    }
  }
  return groups;
}

function uploaderMidFromUrl(url) {
  var value = String(url || '').trim();
  var match = /space\.bilibili\.com\/(\d+)/i.exec(value);
  if (match && match[1]) return match[1];
  match = /[?&]mid=(\d+)/i.exec(value);
  if (match && match[1]) return match[1];
  if (/^\d+$/.test(value)) return value;
  return '';
}
function isUploaderUrl(url) { return Boolean(uploaderMidFromUrl(url)); }
function uploaderInfoPath() { return '/x/space/wbi/acc/info'; }
function uploaderVideosPath() { return '/x/space/wbi/arc/search'; }
function uploaderVideoUrl(bvid) { return 'https://www.bilibili.com/video/' + encodeURIComponent(bvid); }
function videoPlayUrl(video, qualityId) {
  var qn = Number(qualityId) || 127;
  return '/x/player/playurl?bvid=' + encodeURIComponent(video.bvid) + '&cid=' + encodeURIComponent(video.cid) +
    '&qn=' + encodeURIComponent(qn) + '&fnval=4048&fourk=1&fnver=0&otype=json&platform=pc';
}
function uploaderVideoTitle(uploaderName, videoTitle, variant) {
  var label = String(variant && variant.label || '').trim() || 'unknown-quality';
  var sourceName = String(variant && variant.fileName || '');
  var extensionMatch = /\.([a-z0-9]{1,8})$/i.exec(sourceName);
  var extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'mp4';
  return sanitizeFileName(uploaderName + ' - ' + videoTitle + ' [' + label + '].' + extension);
}
async function listUploaderVideos(mid, ctx, cookie, limit) {
  var pageSize = Math.min(30, Math.max(1, Number(limit) || 20));
  var listing = await apiGetWbi(uploaderVideosPath(), { mid: mid, ps: pageSize, pn: 1, order: 'pubdate', platform: 'web', web_location: '1550101' }, ctx, cookie);
  var data = listing && listing.list ? listing.list : listing;
  var videos = data && Array.isArray(data.vlist) ? data.vlist : [];
  var normalized = [], seen = {};
  for (var i = 0; i < videos.length && normalized.length < pageSize; i++) {
    var item = videos[i] || {};
    var bvid = String(item.bvid || item.BV || '');
    if (!bvid || seen[bvid]) continue;
    seen[bvid] = true;
    normalized.push({
      bvid: bvid,
      aid: Number(item.aid) || 0,
      title: sanitizeFileName(String(item.title || bvid).replace(/<[^>]+>/g, '')),
      description: String(item.description || ''),
      cover: String(item.pic || ''),
      pubdate: episodePubDate({ pub_time: item.created }),
      duration: String(item.length || ''),
    });
  }
  var nextIndex = 0;
  async function worker() {
    while (true) {
      var index = nextIndex++;
      if (index >= normalized.length) return;
      var current = normalized[index];
      try {
        var view = await apiGet('/x/web-interface/view?bvid=' + encodeURIComponent(current.bvid), ctx, cookie);
        var pages = view && Array.isArray(view.pages) ? view.pages : [];
        current.cid = Number((pages[0] || {}).cid) || 0;
        current.pageCount = pages.length;
      } catch (e) { current.cid = 0; }
    }
  }
  var workers = Math.min(4, normalized.length), jobs = [];
  for (var wi = 0; wi < workers; wi++) jobs.push(worker());
  await Promise.all(jobs);
  var ready = normalized.filter(function(video) { return video.cid > 0; });
  if (ready.length < normalized.length) pluginLog('warn', '[bilibili] subscription uploader metadata failures', { failed: normalized.length - ready.length, total: normalized.length });
  return ready;
}
async function subscribeUploader(ctx) {
  var mid = uploaderMidFromUrl(ctx.url);
  if (!mid) throw new Error('无法从 Bilibili UP 主链接识别 mid');
  var cookie = await effectiveCookie(ctx);
  var infoResult = await apiGetWbi(uploaderInfoPath(), { mid: mid }, ctx, cookie);
  var info = infoResult && infoResult.card ? infoResult.card : infoResult;
  var uploaderName = sanitizeFileName(String((info && (info.name || info.uname)) || ('UP主 ' + mid)));
  var options = subscriptionOptions('uploader');
  var videos = await listUploaderVideos(mid, ctx, cookie, options.limit);
  if (!videos.length) throw new Error('Bilibili 未返回可订阅的普通投稿视频');
  var items = [];
  var failed = 0;
  for (var i = 0; i < videos.length; i++) {
    var video = videos[i];
    try {
      var play = await apiGet(videoPlayUrl(video), ctx, cookie);
      var variants = subscriptionQualityCandidates(play, video.title, options.highestQualityOnly, options.quality);
      if (!variants.length) failed++;
      for (var vi = 0; vi < variants.length; vi++) {
        var variant = variants[vi], qualityKey = String(variant.qualityId);
        items.push({
          guid: 'video:' + video.bvid + ':cid:' + String(video.cid) + '@q:' + qualityKey,
          title: uploaderVideoTitle(uploaderName, video.title, variant),
          link: uploaderVideoUrl(video.bvid),
          enclosureUrl: '',
          enclosureLength: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
          pubDate: video.pubdate,
          resolverItem: 'video:' + video.bvid + ':cid:' + String(video.cid) + '@q:' + qualityKey,
        });
      }
    } catch (e) { failed++; }
  }
  if (failed) pluginLog('warn', '[bilibili] subscription uploader item failures', { failed: failed, total: videos.length });

  if (!items.length) throw new Error('Bilibili 投稿均未返回可下载画质');
  return { title: 'Bilibili UP主 - ' + uploaderName, link: ctx.url, items: items };
}
function ordinaryVideoMetadata(ctx) {
  var metadata = { platform: 'bilibili', mediaKind: 'post' };
  if (ctx.creatorId) metadata.creatorId = String(ctx.creatorId);
  if (ctx.creatorName) metadata.creatorName = String(ctx.creatorName);
  if (ctx.collectionId) metadata.collectionId = String(ctx.collectionId);
  if (ctx.collectionTitle) metadata.collectionTitle = String(ctx.collectionTitle);
  return metadata;
}

function ordinaryVideoContext(ctx, view) {
  return Object.assign({}, ctx, {
    creatorId: String(view.owner && view.owner.mid || ''),
    creatorName: String(view.owner && view.owner.name || ''),
    collectionId: String(view.ugc_season && view.ugc_season.id || ''),
    collectionTitle: String(view.ugc_season && view.ugc_season.title || ''),
  });
}

function ordinaryVideoParts(view, explicitPage) {
  var pages = Array.isArray(view.pages) ? view.pages : [];
  if (explicitPage && (!pages[explicitPage - 1] || !Number(pages[explicitPage - 1].cid))) {
    throw new Error('Bilibili 未返回指定分 P 的视频信息');
  }
  var title = view.title || view.bvid;
  var parts = [], seen = new Set();
  function add(bvid, aid, cid, name, path, cover) {
    if (!/^BV[0-9a-z]+$/i.test(String(bvid || '')) || !/^[1-9]\d*$/.test(String(cid || ''))) return;
    var id = 'video:' + bvid + ':cid:' + cid;
    if (seen.has(id)) return;
    seen.add(id);
    parts.push({ id: id, bvid: bvid, aid: aid, cid: cid, title: sanitizeFileName(name || bvid), path: path, cover: cover });
  }
  var sections = !explicitPage && view.ugc_season && Array.isArray(view.ugc_season.sections) ? view.ugc_season.sections : [];
  for (var section of sections) {
    if (!section || !Array.isArray(section.episodes)) continue;
    var path = section.title ? sanitizePath(section.title) : '';
    for (var episode of section.episodes) {
      if (!episode) continue;
      var arc = episode.arc || {};
      var page = episode.page || {};
      add(episode.bvid || arc.bvid, episode.aid || arc.aid, episode.cid || page.cid || arc.first_cid,
        episode.title || page.part || arc.title, path, arc.pic || page.first_frame);
    }
  }
  for (var i = 0; i < pages.length; i++) {
    if (!pages[i] || (explicitPage && i !== explicitPage - 1)) continue;
    var name = pages.length > 1 ? title + ' - P' + (i + 1) + ' ' + String(pages[i].part || '') : title;
    add(view.bvid, view.aid, pages[i].cid, name, '', pages[i].first_frame || view.pic);
  }
  if (!parts.length) throw new Error('Bilibili 未返回可下载的普通视频分 P');
  if (parts.length > MAX_EPISODES) throw new Error('Bilibili 视频分 P 或合集超过 FluxDown 单次 1000 项上限；请用 ?p=N 下载单 P');
  return parts;
}
async function resolveVideoPage(ctx) {
  var url = String(ctx.url || '').trim();
  var match = /^https?:\/\/(?:(?:www|m)\.)?bilibili\.com\/video\/(BV[0-9a-z]+|av\d+)\/?(?:[?#]|$)/i.exec(url);
  if (!match) throw new Error('无法从 Bilibili 视频链接识别 BV 或 AV 号');
  var id = match[1];
  var lookup = /^av/i.test(id) ? 'aid=' + id.slice(2) : 'bvid=' + encodeURIComponent(id);
  var cookie = await effectiveCookie(ctx);
  var view = await apiGet('/x/web-interface/view?' + lookup, ctx, cookie);
  var pageMatch = /[?&]p=([^&#]*)/i.exec(url.split('#')[0]);
  var pageNumber = pageMatch ? Number(pageMatch[1]) : 0;
  if (pageMatch && (!/^[1-9]\d*$/.test(pageMatch[1]) || !Number.isSafeInteger(pageNumber))) {
    throw new Error('Bilibili 视频分 P 参数非法');
  }
  var parts = ordinaryVideoParts(view, pageNumber);
  var context = ordinaryVideoContext(ctx, view);
  var kinds = selectedBiliResources();
  if (parts.length === 1 && !kinds.length) {
    return await resolveUploaderVideo(Object.assign(context, { title: parts[0].title, resolverItem: parts[0].id }), cookie);
  }
  var audioOnly = setting('quality', 'best') === 'audio';
  var items = parts.map(function(part) {
    return { id: part.id, name: part.title + (audioOnly ? ' [audio]' : '.mp4'), path: part.path, size: 0, kind: 'file' };
  });
  items = await withBiliResourceItems(ctx, items, parts, cookie, kinds);
  var title = sanitizeFileName(context.collectionTitle || view.title || view.bvid);
  return { manifest: { name: title, items: fitManifestItems(items), archiveMetadata: ordinaryVideoMetadata(context) } };
}

async function resolveUploaderVideo(ctx, knownCookie) {
  var match = /^video:([^:]+):cid:(\d+)(?:@q:(\d+|h\d+))?$/.exec(String(ctx.resolverItem || ''));
  if (!match) throw new Error('Bilibili 投稿视频标识非法: ' + String(ctx.resolverItem || ''));
  var video = { bvid: match[1], cid: Number(match[2]) }, qualityKey = match[3] || '';
  var cookie = knownCookie == null ? await effectiveCookie(ctx) : knownCookie;
  var requestedQualityId = /^\d+$/.test(qualityKey) ? Number(qualityKey) : 0;
  var play = await apiGet(videoPlayUrl(video, requestedQualityId), ctx, cookie);
  var resolvedTitle = '';
  var resolvedView = null;
  if (!ctx.title || !ctx.creatorId || !ctx.creatorName) {
    try {
      resolvedView = await apiGet('/x/web-interface/view?bvid=' + encodeURIComponent(video.bvid), ctx, cookie);
      resolvedTitle = String(resolvedView && resolvedView.title || '');
    } catch (e) {}
  }
  var resultContext = Object.assign({}, ctx);
  if (!resultContext.creatorId && resolvedView && resolvedView.owner) resultContext.creatorId = String(resolvedView.owner.mid || '');
  if (!resultContext.creatorName && resolvedView && resolvedView.owner) resultContext.creatorName = String(resolvedView.owner.name || '');
  if (!resultContext.collectionId && resolvedView && resolvedView.ugc_season) {
    resultContext.collectionId = String(resolvedView.ugc_season.id || '');
    resultContext.collectionTitle = String(resolvedView.ugc_season.title || '');
  }
  var pages = resolvedView && Array.isArray(resolvedView.pages) ? resolvedView.pages : [];
  var pageIndex = pages.findIndex(function(page) { return page && Number(page.cid) === video.cid; });
  if (resolvedTitle && pages.length > 1 && pageIndex >= 0) {
    resolvedTitle += ' - P' + (pageIndex + 1) + ' ' + String(pages[pageIndex].part || '');
  }
  var title = sanitizeFileName(String(ctx.title || resolvedTitle || video.bvid));
  return resolvePlayResult(play, title, qualityKey, requestHeaders(cookie, ctx), ordinaryVideoMetadata(resultContext));
}

async function subscribeBangumi(ctx) {
  var options = subscriptionOptions('bangumi');

  var cookie = await effectiveCookie(ctx);
  var seasonId = await seasonIdFromUrl(ctx.url, ctx, cookie);
  if (!seasonId) throw new Error('无法从 Bilibili 番剧链接识别 season_id 或 media_id');


  var result = await apiGet(
    '/pgc/view/web/season?season_id=' + encodeURIComponent(seasonId),
    ctx,
    cookie
  );
  var title = sanitizeFileName(result.title || result.season_title || ('Bilibili ' + seasonId));
  var episodes = [];
  var seen = {};
  var groups = subscriptionEpisodeGroups(result, options.includeExtras);
  for (var gi = 0; gi < groups.length; gi++) {
    var group = groups[gi];
    for (var ei = 0; ei < group.episodes.length; ei++) {
      var episode = group.episodes[ei] || {};
      var epId = String(episode.id || episode.ep_id || '');
      if (!epId || seen[epId]) continue;
      seen[epId] = true;
      episodes.push({
        id: epId,
        episode: episode,
        name: episodeDisplayName(result, epId, episode),
      });
    }
  }
  if (episodes.length > options.limit) {
    pluginLog('info', '[bilibili] subscription limited to recent episodes', { total: episodes.length, limit: options.limit });
    episodes = episodes.slice(-options.limit);
  }
  if (!episodes.length) throw new Error('Bilibili 未返回可订阅分集');

  // 订阅条目沿用直接下载的 DASH 画质集合；实际下载时由核心把
  // resolverItem 传回本插件二段解析，以复用视频轨 + 音频轨合并逻辑。
  var items = new Array(episodes.length);
  var nextIndex = 0;
  var failed = 0;
  async function worker() {
    while (true) {
      var index = nextIndex++;
      if (index >= episodes.length) return;
      var current = episodes[index];
      try {
        var play = await apiGet(playerPlayUrl(current.episode), ctx, cookie);
        var candidates = subscriptionQualityCandidates(play, current.name, options.highestQualityOnly, options.quality);
        if (!candidates.length) failed++;
        for (var qi = 0; qi < candidates.length; qi++) {
          var candidate = candidates[qi];
          var qualityKey = String(candidate.qualityId);
          var displayVariant = {
            label: candidate.label,
            qualityId: candidate.qualityId,
            height: candidate.height,
            fileName: current.name + '.mp4',
          };
          var item = {
            guid: 'ep:' + current.id + '@q:' + qualityKey,
            title: subscriptionItemTitle(title, current.name, displayVariant),
            link: episodePageUrl(current.id, current.episode),
            enclosureUrl: '',
            enclosureLength: Number(candidate.totalBytes) > 0 ? Number(candidate.totalBytes) : 0,
            pubDate: episodePubDate(current.episode),
            resolverItem: 'ep:' + current.id + '@q:' + qualityKey,
          };
          if (!items[index]) items[index] = [];
          items[index].push(item);
        }
      } catch (e) {
        failed++;
      }
    }
  }
  var workers = Math.min(6, episodes.length);
  var jobs = [];
  for (var wi = 0; wi < workers; wi++) jobs.push(worker());
  await Promise.all(jobs);

  var ready = [];
  for (var ri = 0; ri < items.length; ri++) {
    if (items[ri]) {
      for (var ii = 0; ii < items[ri].length; ii++) ready.push(items[ri][ii]);
    }
  }
  if (failed) pluginLog('warn', '[bilibili] subscription bangumi item failures', { failed: failed, total: episodes.length });
  if (!ready.length) throw new Error('Bilibili 分集均未返回可下载的单文件直链');
  return {
    title: title,
    link: ctx.url,
    items: ready,
  };
}


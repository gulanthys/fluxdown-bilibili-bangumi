// Manifest tokens contain only stable media identifiers, never expiring URLs.
var RESOURCE_KINDS = new Set(['cover', 'subtitles', 'aiSubtitles', 'danmakuXml', 'danmakuAss']);

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

function resourceManifestItem(media, kind, name, lang) {
  return { id: 'resource:' + kind + ':' + media.id + (lang ? ':lang:' + lang : ''),
    name: name, path: media.path || '', size: 0, kind: 'file' };
}

async function resourceMediaFromId(ctx, cookie) {
  var token = /^resource:([^:]+):(?:(ep):([1-9]\d*)|video:(BV[0-9a-z]+):cid:([1-9]\d*))(?:\:lang:([a-z0-9_-]{1,48}))?$/i.exec(String(ctx.resolverItem || ''));
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
  return { media: media, kind: token[1], lang: token[6] || '' };
}

async function resourcePlayerData(ctx, media, cookie) {
  var params = media.bvid ? { bvid: media.bvid, cid: media.cid } : { aid: media.aid, cid: media.cid };
  try {
    return await apiGetWbi('/x/player/wbi/v2', params, ctx, cookie);
  } catch (error) {
    var query = Object.keys(params).map(function(key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
    return await apiGet('/x/player/v2?' + query, ctx, cookie);
  }
}

function resourceSubtitleEntries(player) {
  var result = [];
  var blocks = [player && player.subtitle, player && player.ai_subtitle, player && player.subtitle_info];
  blocks.forEach(function (block) {
    var subtitles = block && (block.subtitles || block.list);
    if (!Array.isArray(subtitles)) return;
    subtitles.forEach(function (sub) {
      if (!sub || !sub.subtitle_url) return;
      var language = sub.lan || sub.lan_doc || 'und';
      var ai = !!(sub.ai_type || sub.type === 'ai' || block.ai_subtitle || block.type === 'ai' || /^ai-/i.test(language));
      result.push({ url: sub.subtitle_url, lang: language, label: sub.lan_doc || language || (ai ? 'AI subtitle' : 'Subtitle'), ai: ai });
    });
  });
  return result;
}
function resourceProtoTracks(base64) {
  var binary = atob(String(base64 || ''));
  if (binary.length > 1024 * 1024) throw new Error('Bilibili subtitle metadata is too large');
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  function parseFields(input, wanted) {
    var offset = 0, fields = [];
    function varint() {
      var result = 0, factor = 1;
      for (var n = 0; n < 10; n++) {
        if (offset >= input.length) throw new Error('Truncated Bilibili subtitle metadata');
        var byte = input[offset++];
        result += (byte & 127) * factor;
        if (byte < 128) return result;
        factor *= 128;
      }
      throw new Error('Invalid Bilibili subtitle metadata varint');
    }
    while (offset < input.length) {
      var tag = varint(), number = Math.floor(tag / 8), wire = tag & 7;
      if (!number) throw new Error('Invalid Bilibili subtitle metadata field');
      if (wire === 0) varint();
      else if (wire === 1 || wire === 5) {
        offset += wire === 1 ? 8 : 4;
        if (offset > input.length) throw new Error('Truncated Bilibili subtitle metadata');
      } else if (wire === 2) {
        var length = varint(), end = offset + length;
        if (end > input.length) throw new Error('Truncated Bilibili subtitle metadata');
        if (number === wanted) fields.push(input.slice(offset, end));
        offset = end;
      } else throw new Error('Unsupported Bilibili subtitle metadata wire type');
    }
    return fields;
  }
  function utf8(array) {
    var text = '';
    for (var p = 0; p < array.length; p += 8192) {
      var chunk = array.subarray(p, Math.min(array.length, p + 8192));
      text += String.fromCharCode.apply(null, chunk);
    }
    try { return decodeURIComponent(escape(text)); } catch (e) { throw new Error('Invalid Bilibili subtitle metadata text'); }
  }
  var tracks = [];
  parseFields(bytes, 1).forEach(function (data) {
    parseFields(data, 3).forEach(function (track) {
      var fields = {};
      [3, 4, 5].forEach(function (field) {
        var values = parseFields(track, field);
        if (values.length) fields[field] = utf8(values[0]);
      });
      var language = fields[3] || 'und';
      tracks.push({ lan: language, lan_doc: fields[4] || language || 'Subtitle', subtitle_url: fields[5], ai: /^ai-/i.test(language) });
    });
  });
  return tracks;
}
async function resourceProtoSubtitleData(ctx, media, cookie) {
  if (!media.cid || (!media.bvid && !media.aid)) return [];
  var aid = media.aid;
  if (!aid && media.bvid) {
    var video = await apiGet('/x/web-interface/view?bvid=' + encodeURIComponent(media.bvid), ctx, cookie);
    aid = video.aid;
  }
  if (!aid) return [];
  var query = [
    'oid=' + encodeURIComponent(media.cid),
    'pid=' + encodeURIComponent(aid),
    'context_ext=' + encodeURIComponent('{\"video_type\":1}'),
    'type=1',
    'cur_production_type=0',
    'preferred_language=ai-zh',
    'playlist_switch=0',
  ].join('&');
  var response = await flux.fetch({ method: 'GET', url: API_BASE + '/x/v2/subtitle/web/view?' + query,
    headers: requestHeaders(cookie, ctx), responseType: 'base64' });
  if (!response || response.status < 200 || response.status >= 300) return [];
  if (response.truncated) throw new Error('Bilibili AI 字幕元数据已截断');
  var body = String(response.body || '');
  if (/^\s*\{/.test(atob(body.slice(0, 44)))) return [];
  return resourceProtoTracks(body);
}
async function resourceSubtitleTracks(ctx, media, cookie, includeAi) {
  if (!media.cid || (!media.bvid && !media.aid)) return [];
  var entries = [], playerError;
  try {
    entries = resourceSubtitleEntries(await resourcePlayerData(ctx, media, cookie));
  } catch (error) {
    playerError = error;
  }
  if (includeAi && !entries.some(function(entry) { return entry.ai && resourceUrl(entry.url); })) {
    try {
      for (var sub of await resourceProtoSubtitleData(ctx, media, cookie)) {
        if (sub.ai) entries.push({ url: sub.subtitle_url, lang: sub.lan, label: sub.lan_doc, ai: true });
      }
    } catch (error) {
      if (!entries.length) throw error;
      pluginLog('warn', '[bilibili] AI subtitle lookup failed; human tracks remain available');
    }
  }
  if (!entries.length && playerError) throw playerError;
  var seen = new Set();
  return entries.filter(function(entry) {
    var key = String(entry.ai) + ':' + entry.lang;
    if (!/^[a-z0-9_-]{1,48}$/i.test(entry.lang) || !resourceUrl(entry.url) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resourceSubtitleName(label, track) {
  return label + ' - ' + (track.ai ? 'AI ' : '') + resourceName(track.label) + ' [' + track.lang + '].srt';
}

async function listBiliResources(ctx, media, cookie, kinds) {
  var selected = new Set(kinds), items = [];
  var label = resourceName(media.title), image = resourceUrl(media.cover);
  if (selected.has('cover') && image) {
    items.push(resourceManifestItem(media, 'cover', label + ' - 封面.' + resourceImageExtension(image)));
  }
  if (selected.has('subtitles') || selected.has('aiSubtitles')) {
    var tracks = await resourceSubtitleTracks(ctx, media, cookie, selected.has('aiSubtitles'));
    for (var track of tracks) {
      var key = track.ai ? 'aiSubtitles' : 'subtitles';
      if (selected.has(key)) items.push(resourceManifestItem(media, key, resourceSubtitleName(label, track), track.lang));
    }
  }
  if (media.cid) {
    if (selected.has('danmakuXml')) items.push(resourceManifestItem(media, 'danmakuXml', label + ' - 弹幕.xml'));
    if (selected.has('danmakuAss')) items.push(resourceManifestItem(media, 'danmakuAss', label + ' - 弹幕.ass'));
  }
  return items;
}

function resourceSrtTime(seconds) {
  var ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  var h = Math.floor(ms / 3600000); ms %= 3600000;
  var m = Math.floor(ms / 60000); ms %= 60000;
  var s = Math.floor(ms / 1000); ms %= 1000;
  function pad(n, length) { return String(n).padStart(length, '0'); }
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
}
function resourceSubtitleSrt(json) {
  if (!json || !Array.isArray(json.body)) throw new Error('Bilibili 字幕没有有效的字幕段');
  var cues = json.body.filter(function(cue) {
    return cue && Number.isFinite(cue.from) && Number.isFinite(cue.to) && cue.from >= 0 &&
      cue.to >= cue.from && typeof cue.content === 'string' && cue.content.trim();
  });
  if (!cues.length) throw new Error('Bilibili 字幕没有有效的字幕段');
  return cues.map(function(cue, index) {
    return (index + 1) + '\n' + resourceSrtTime(cue.from) + ' --> ' + resourceSrtTime(cue.to) + '\n' +
      cue.content.replace(/\r\n?/g, '\n').split('\n').filter(Boolean).join('\n');
  }).join('\n\n') + '\n';
}

function resourceAssTime(seconds) {
  return resourceSrtTime(Math.round(seconds * 100) / 100).replace(',', '.').slice(0, -1);
}

function resourceXmlText(text) {
  var entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi, function(match, entity) {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
    var n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : match;
  });
}

function resourceDanmakuAss(xml) {
  var header = '[Script Info]\nTitle: Bilibili Danmaku\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,1,2,0,7,20,20,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  if (!/<i(?:\s[^>]*)?>[\s\S]*<\/i>/.test(xml)) throw new Error('Bilibili 返回的弹幕不是有效 XML');
  var entries = [], match, re = /<d\s+[^>]*\bp="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
  while ((match = re.exec(xml))) {
    var raw = match[1].split(',');
    var start = Number(raw[0]), mode = Number(raw[1]), color = Number(raw[3]);
    if (!Number.isFinite(start) || start < 0 || ![1, 2, 3, 4, 5, 6].includes(mode)) continue;
    var text = resourceXmlText(match[2]).replace(/[{}\\\r\n]/g, ' ').trim();
    if (!text) continue;
    var size = Math.min(64, Math.max(18, Number(raw[2]) || 25));
    var rgb = Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : 0xffffff;
    entries.push({ start: start, mode: mode, text: text, size: size, rgb: rgb });
  }
  entries.sort(function(a, b) { return a.start - b.start; });
  var rows = [], scroll = new Array(20).fill(0), top = new Array(5).fill(0), bottom = new Array(5).fill(0);
  for (var entry of entries) {
    var lanes = entry.mode === 4 ? bottom : entry.mode === 5 ? top : scroll;
    var lane = lanes.findIndex(function(until) { return until <= entry.start; });
    if (lane < 0) lane = lanes.indexOf(Math.min.apply(null, lanes));
    var duration = lanes === scroll ? 8 : 4;
    lanes[lane] = entry.start + duration;
    var y = entry.mode === 4 ? 1062 - lane * 54 : 18 + lane * 52;
    var position;
    if (lanes !== scroll) {
      position = '\\an' + (entry.mode === 4 ? '2' : '8') + '\\pos(960,' + y + ')';
    } else {
      var left = -Math.max(1, Array.from(entry.text).length) * entry.size, right = 1920;
      position = '\\an7\\move(' + (entry.mode === 6 ? left : right) + ',' + y + ',' +
        (entry.mode === 6 ? right : left) + ',' + y + ')';
    }
    var bgr = ((entry.rgb & 255) << 16) | (entry.rgb & 0xff00) | (entry.rgb >> 16);
    var style = '{' + position + '\\fs' + entry.size + '\\c&H' + bgr.toString(16).padStart(6, '0') + '&}';
    rows.push('Dialogue: 0,' + resourceAssTime(entry.start) + ',' + resourceAssTime(entry.start + duration) +
      ',Default,,0,0,0,,' + style + entry.text);
  }
  return header + rows.join('\n') + (rows.length ? '\n' : '');
}

function resourceDownloadHeaders() {
  return { Referer: 'https://www.bilibili.com/', 'User-Agent': USER_AGENT };
}

async function resourceFetch(url) {
  var allowed = resourceUrl(url);
  if (!allowed) throw new Error('Bilibili 附加资源地址不在允许的域名内');
  var response = await flux.fetch({ method: 'GET', url: allowed, headers: resourceDownloadHeaders() });
  if (!response || response.status < 200 || response.status >= 300) throw new Error('Bilibili 附加资源下载失败');
  if (response.truncated) throw new Error('Bilibili 附加资源响应已截断');
  return response.body || '';
}

function resourceContent(text, fileName) {
  return { contentBase64: btoa(unescape(encodeURIComponent(text))), fileName: fileName };
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
  if (kind === 'danmakuXml' || kind === 'danmakuAss') {
    if (!/^[1-9]\d*$/.test(String(media.cid))) throw new Error('Bilibili 弹幕缺少 CID');
    var xmlUrl = 'https://comment.bilibili.com/' + media.cid + '.xml';
    if (kind === 'danmakuXml') return { url: xmlUrl, fileName: name + ' - 弹幕.xml', extraHeaders: resourceDownloadHeaders() };
    return resourceContent(resourceDanmakuAss(await resourceFetch(xmlUrl)), name + ' - 弹幕.ass');
  }
  var ai = kind === 'aiSubtitles';
  var tracks = await resourceSubtitleTracks(ctx, media, cookie, ai);
  var chosen = tracks.find(function(track) { return track.ai === ai && track.lang === resolved.lang; });
  if (!chosen) throw new Error('Bilibili 所选字幕轨已不可用');
  return resourceContent(resourceSubtitleSrt(JSON.parse(await resourceFetch(chosen.url))), resourceSubtitleName(name, chosen));
}

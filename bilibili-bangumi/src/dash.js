function streamUrl(stream) {
  if (!stream || typeof stream !== 'object') return '';
  var primary = stream.base_url || stream.baseUrl || stream.url || '';
  if (primary) return String(primary);
  var backups = stream.backup_url || stream.backupUrl;
  if (Array.isArray(backups) && backups.length && backups[0]) return String(backups[0]);
  return '';
}

function audioUrl(stream) {
  return streamUrl(stream);
}

function streamSize(stream) {
  var value = Number(stream && (stream.size || stream.filesize || stream.filesize_approx)) || 0;
  return value > 0 ? value : 0;
}

function mediaMime(stream) {
  return String(stream && (stream.mime_type || stream.mimeType) || '').toLowerCase().split(';')[0].trim();
}

function isMp4CompatibleAudio(track) {
  var mime = mediaMime(track);
  return !mime || mime === 'audio/mp4';
}

function pickAudioTrack(audios) {
  var best = null;
  var score = -1;
  var hasUsableUrl = false;
  for (var i = 0; i < audios.length; i++) {
    var track = audios[i];
    if (!track || !streamUrl(track)) continue;
    hasUsableUrl = true;
    if (!isMp4CompatibleAudio(track)) continue;
    var current = Number(track.bandwidth) || Number(track.id) || 0;
    if (current > score) {
      score = current;
      best = track;
    }
  }
  if (!best && hasUsableUrl) throw new Error('Bilibili 返回了不兼容 MP4/M4A 封装的音轨');
  return best;
}

var AUDIO_LEVELS = [30216, 30232, 30280, 30250, 30251];

function dashAudioTrack(dash) {
  var regular = Array.isArray(dash.audio) ? dash.audio : [];
  var preferred = String(setting('audioQuality', 'auto'));
  if (preferred === 'auto') return pickAudioTrack(regular);
  var target = AUDIO_LEVELS.indexOf(Number(preferred));
  var tracks = regular.slice();
  if (dash.dolby && Array.isArray(dash.dolby.audio)) {
    for (var dolby of dash.dolby.audio) {
      if (dolby) tracks.push(Object.assign({}, dolby, { id: 30250 }));
    }
  }
  if (dash.flac && dash.flac.audio) tracks.push(Object.assign({}, dash.flac.audio, { id: 30251 }));
  var best = null, bestDistance = Infinity, bestBandwidth = -1;
  for (var track of tracks) {
    if (!track || !streamUrl(track)) continue;
    var rank = AUDIO_LEVELS.indexOf(Number(track.id));
    if (!isMp4CompatibleAudio(track) && !(rank === 4 && mediaMime(track) === 'audio/flac')) continue;
    var distance = rank < 0 ? AUDIO_LEVELS.length * 2 :
      rank <= target ? target - rank : AUDIO_LEVELS.length + rank - target;
    var bandwidth = Number(track.bandwidth) || 0;
    if (distance < bestDistance || (distance === bestDistance && bandwidth > bestBandwidth)) {
      best = track;
      bestDistance = distance;
      bestBandwidth = bandwidth;
    }
  }
  return best || pickAudioTrack(regular);
}

function audioFileExtension(audio) {
  if (Number(audio.id) === 30251) return mediaMime(audio) === 'audio/flac' ? 'flac' : 'mp4';
  return 'm4a';
}

function audioOnlyVariant(audio, title) {
  var extension = audioFileExtension(audio);
  return {
    label: '仅音频 (' + extension.toUpperCase() + ')',
    url: audioUrl(audio),
    audioUrl: '',
    fileName: title + ' [audio].' + extension,
    totalBytes: streamSize(audio),
    bandwidth: Number(audio.bandwidth) || 0,
    width: 0,
    height: 0,
    container: extension,
  };
}

function videoContainer(video) {
  var mime = mediaMime(video);
  if (!mime || mime === 'video/mp4') return 'mp4';
  throw new Error('Bilibili 返回了非 MP4 视频流，当前下载器不能在不转码的情况下封装：' + mime);
}


function videoHeight(video) {
  var height = Number(video.height) || Number(video.height_cm) || 0;
  if (height) return height;
  var qualityId = Number(video.id) || Number(video.quality) || 0;
  return QUALITY_HEIGHT_BY_ID[qualityId] || 0;
}

function videoQualityTag(video, height) {
  if (!height) return 'unknown-quality';
  var width = Number(video.width) || 0;
  return width ? height + 'p-' + width + 'x' + height : height + 'p';
}

function videoCodec(video) {
  var codecs = String(video && (video.codecs || video.codecs_name) || '').toLowerCase();
  var id = Number(video && video.codecid);
  if (/avc1|avc3|h264|avc/.test(codecs) || id === 7) return 'avc';
  if (/hev1|hvc1|hevc|h265/.test(codecs) || id === 12) return 'hevc';
  if (/av01|av1/.test(codecs) || id === 13) return 'av1';
  return '';
}

function videoCodecScore(video, preferred) {
  var codec = videoCodec(video);
  if (codec && codec === preferred) return 4;
  if (codec === 'avc') return 3;
  if (codec === 'hevc') return 2;
  if (codec === 'av1') return 1;
  return 0;
}

function videoQualityLabel(video, height, play) {
  if (!height) return 'Unknown quality';
  var qualityId = Number(video.id) || Number(video.quality) || 0;
  var label = qualityLabelFromPlay(play || {}, qualityId, height);
  // 文件名只保留 Bilibili 画质名称，不把分辨率和编码信息拼进去。
  // 没有 support_formats 描述时，用质量码保证同分辨率条目仍可区分。
  if (qualityId && label === height + 'p') label += ' [qn' + qualityId + ']';
  return label;
}

function buildDashVariants(videos, audio, title, play, preferredCodec) {
  var candidates = [];
  var seen = {};
  for (var i = 0; i < videos.length; i++) {
    var video = videos[i];
    var url = streamUrl(video);
    var height = videoHeight(video);
    var qualityId = Number(video.id) || Number(video.quality) || 0;
    var key = qualityId ? 'q' + qualityId : 'h' + height;
    if (!url || !height) continue;
    var previousIndex = seen[key];
    if (previousIndex != null) {
      var previous = candidates[previousIndex];
      var currentScore = videoCodecScore(video, preferredCodec);
      var previousScore = videoCodecScore(previous.video, preferredCodec);
      if (currentScore > previousScore ||
          (currentScore === previousScore &&
            (Number(video.bandwidth) || 0) > (Number(previous.video.bandwidth) || 0))) {
        candidates[previousIndex] = { video: video, height: height };
      }
      continue;
    }
    seen[key] = candidates.length;
    candidates.push({ video: video, height: height });
  }
  candidates.sort(function(a, b) {
    if (b.height !== a.height) return b.height - a.height;
    return (Number(b.video.bandwidth) || 0) - (Number(a.video.bandwidth) || 0);
  });

  var variants = [];
  for (var ci = 0; ci < candidates.length && variants.length < MAX_VARIANTS; ci++) {
    var item = candidates[ci];
    var video = item.video;
    var label = videoQualityLabel(video, item.height, play);
    var tag = variantQualityTag({ label: label, qualityId: Number(video.id) || Number(video.quality) || 0, height: item.height });
    var container = videoContainer(video);
    var variant = {
      label: label,
      url: streamUrl(video),
      audioUrl: '',
      fileName: title + ' [' + tag + '].' + container,
      qualityId: Number(video.id) || Number(video.quality) || 0,
      totalBytes: streamSize(video) + streamSize(audio),
      bandwidth: Number(video.bandwidth) || 0,
      width: Number(video.width) || 0,
      height: item.height,
      container: container,
    };
    if (audio) {
      variant.audioUrl = audioUrl(audio);
    }
    variants.push(variant);
  }
  if (audio && variants.length < MAX_VARIANTS) variants.push(audioOnlyVariant(audio, title));
  return variants;
}

function buildDurlVariants(play, title) {
  var entries = [];
  if (Array.isArray(play.durls) && play.durls.length) {
    entries = play.durls;
  } else if (Array.isArray(play.durl)) {
    entries = [{ quality: play.quality, durl: play.durl }];
  } else if (play.durl) {
    entries = [{ quality: play.quality, durl: [play.durl] }];
  }

  var candidates = [];
  var seen = {};
  for (var i = 0; i < entries.length; i++) {
    var source = entries[i] || {};
    var parts = Array.isArray(source.durl) ? source.durl : [];
    if (parts.length > 1) throw new Error('Bilibili 返回分段 durl，插件尚不支持完整分段合并；拒绝只下载首段');
    var part = parts[0] || source;
    var url = String(part.url || '');
    var qualityId = Number(source.quality || part.quality || play.quality || 0);
    var height = qualityHeight(qualityId);
    var key = String(qualityId || height || url);
    if (!url || seen[key]) continue;
    seen[key] = true;
    var durationMs = Number(play.timelength) || 0;
    var bandwidth = durationMs > 0 && Number(part.size) > 0
      ? Math.round(Number(part.size) * 8 * 1000 / durationMs)
      : 0;
    candidates.push({
      part: part,
      qualityId: qualityId,
      height: height,
      bandwidth: bandwidth,
    });
  }
  candidates.sort(function(a, b) {
    if (b.height !== a.height) return b.height - a.height;
    return b.qualityId - a.qualityId;
  });

  var variants = [];
  var format = String(play.format || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!format) format = 'mp4';
  for (var ci = 0; ci < candidates.length && variants.length < MAX_VARIANTS; ci++) {
    var item = candidates[ci];
    var label = qualityLabelFromPlay(play, item.qualityId, item.height);
    var tag = variantQualityTag({ label: label, qualityId: item.qualityId, height: item.height });
    variants.push({
      label: label,
      qualityId: item.qualityId,
      url: String(item.part.url),
      fileName: title + ' [' + tag + '].' + format,
      totalBytes: Number(item.part.size) > 0 ? Number(item.part.size) : 0,
      bandwidth: item.bandwidth,
      width: 0,
      height: item.height,
      container: format,
    });
  }
  return variants;
}

function buildVariantsFromPlay(play, title) {
  var dash = play && play.dash ? play.dash : {};
  var videos = Array.isArray(dash.video) ? dash.video : [];
  var dashVariants = buildDashVariants(videos, dashAudioTrack(dash), title, play, String(setting('videoCodec', 'auto')));
  return dashVariants.length ? dashVariants : buildDurlVariants(play || {}, title);
}

function mediaResolveResult(variant, headers, archiveMetadata) {
  return {
    url: variant.url, audioUrl: variant.audioUrl || '', fileName: variant.fileName,
    totalBytes: variant.totalBytes, extraHeaders: headers,
    ephemeral: true, rangeSupported: true, archiveMetadata: archiveMetadata,
  };
}

function resolvePlayResult(play, title, qualityKey, headers, archiveMetadata) {
  var quality = String(setting('quality', 'best'));
  if (!qualityKey && quality === 'audio') {
    var audio = dashAudioTrack(play.dash || {});
    if (!audio) throw new Error('Bilibili 当前没有独立音频轨');
    return mediaResolveResult(audioOnlyVariant(audio, title), headers, archiveMetadata);
  }
  var variants = buildVariantsFromPlay(play, title);
  var chosenIndex = qualityKey ? chooseVariantIndex(variants, qualityKey) : chooseDashIndex(variants, quality);
  if (chosenIndex < 0) throw new Error('Bilibili 未返回所选画质: ' + qualityKey);
  var result = mediaResolveResult(variants[chosenIndex], headers, archiveMetadata);
  if (!qualityKey) {
    result.variants = variants;
    result.defaultVariantIndex = chosenIndex;
  }
  return result;
}

function buildManifestVariantsFromPlay(play, title) {
  // accept_quality also contains login-only qualities. Only expose variants
  // that have an actual video URL, otherwise selecting one creates an item
  // that can never be resolved successfully.
  var variants = buildVariantsFromPlay(play, title).slice();
  variants.sort(function(a, b) {
    if (Number(b.height) !== Number(a.height)) return Number(b.height) - Number(a.height);
    return (Number(b.qualityId) || 0) - (Number(a.qualityId) || 0);
  });
  return variants.slice(0, MAX_VARIANTS);
}


function selectListedQualityVariants(variants, highestQualityOnly) {
  if (!highestQualityOnly) return variants;
  var best = null;
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i] || {};
    var height = Number(variant.height) || 0;
    if (!height) continue;
    if (!best || height > Number(best.height) ||
        (height === Number(best.height) &&
          (Number(variant.qualityId) || 0) > (Number(best.qualityId) || 0))) {
      best = variant;
    }
  }
  return best ? [best] : [];
}

function buildEpisodeItems(episodes, qualityVariants) {
  var items = [];
  for (var ii = 0; ii < episodes.length; ii++) {
    var episode = episodes[ii];
    var variants = qualityVariants[ii] || [];
    var added = false;
    for (var vi = 0; vi < variants.length; vi++) {
      var variant = variants[vi];
      if (!(Number(variant.height) > 0)) continue;
      var qualityKey = variantQualityKey(variant);
      if (!qualityKey) continue;
      items.push({
        id: 'ep:' + episode.id + '@q:' + qualityKey,
        name: episode.baseName + ' [' + variantQualityTag(variant) + '].' + (variant.container || 'mp4'),
        path: episode.path,
        size: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
        kind: 'file',
      });
      added = true;
    }
    if (!added) items.push({ id: 'ep:' + episode.id, name: episode.baseName + '.mp4', path: episode.path, size: 0, kind: 'file' });
  }
  return fitManifestItems(items);
}

function chooseDashIndex(variants, quality) {
  if (!variants.length) throw new Error('Bilibili 未返回可用画质');
  if (quality === 'audio') {
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].height === 0) return i;
    }
    throw new Error('Bilibili 当前没有独立音频轨');
  }
  if (quality === 'best') return 0;
  var target = Number(quality);
  if (!(target > 0)) throw new Error('不支持的画质设置: ' + String(quality));
  var best = -1;
  var bestHeight = 0;
  for (var j = 0; j < variants.length; j++) {
    var height = Number(variants[j].height) || 0;
    if (height && height <= target && height >= bestHeight) {
      best = j;
      bestHeight = height;
    }
  }
  if (best < 0) throw new Error('Bilibili 没有不超过 ' + target + 'p 的可用画质');
  return best;
}



function selectedBiliResources() {
  return ['cover', 'subtitles', 'aiSubtitles', 'danmakuXml', 'danmakuAss'].filter(function(kind) {
    return setting(kind, false) === true;
  });
}

async function withBiliResourceItems(ctx, items, parts, cookie, kinds) {
  if (!kinds.length) return items;
  var resources = new Array(parts.length), next = 0, count = items.length;
  async function worker() {
    while (next < parts.length) {
      var index = next++;
      var more = await listBiliResources(ctx, parts[index], cookie, kinds);
      count += more.length;
      if (count > MAX_EPISODES) throw new Error('视频和附加资源超过 FluxDown 单次 1000 项上限；请缩小分集或附加资源范围');
      resources[index] = more;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, parts.length) }, worker));
  return items.concat(resources.flat());
}

globalThis.resolve = async (ctx) => {
  if (String(ctx.resolverItem || '').indexOf('resource:') === 0) return await resolveBiliResource(ctx);
  if (String(ctx.resolverItem || '').indexOf('video:') === 0) return await resolveUploaderVideo(ctx);
  if (ctx.resolverItem) return await resolveEpisode(ctx);
  ctx = await expandBilibiliShortUrl(ctx);
  if (/^https?:\/\/(?:(?:www|m)\.)?bilibili\.com\/video\//i.test(String(ctx.url || '').trim())) return await resolveVideoPage(ctx);
  return await resolveManifest(ctx);
};

globalThis.subscribe = async (ctx) => {
  ctx = await expandBilibiliShortUrl(ctx);
  return isUploaderUrl(ctx.url) ? await subscribeUploader(ctx) : await subscribeBangumi(ctx);
};

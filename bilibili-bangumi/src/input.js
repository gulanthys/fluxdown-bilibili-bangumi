// Canonicalize common Bilibili links and share text before resolver dispatch.
function normalizeBiliInput(input) {
  var text = String(input == null ? '' : input).trim();
  if (!text) throw biliLibraryError('inputEmpty');

  function fromToken(token) {
    var match = /^(av|ep|ss)?(0*[1-9]\d*)$/i.exec(token);
    if (match) {
      var kind = (match[1] || 'av').toLowerCase();
      var id = match[2].replace(/^0+/, '');
      return 'https://www.bilibili.com/' + (kind === 'av' ? 'video/' : 'bangumi/play/') + kind + id;
    }
    var bv = /^bv(1[0-9a-z]{9})$/i.exec(token);
    return bv ? 'https://www.bilibili.com/video/BV' + bv[1] : '';
  }

  var bare = fromToken(text);
  if (bare) return bare;

  // Preserve explicit part and season selectors instead of extracting the ID
  // from inside a URL (which would also trust IDs on unrelated domains).
  var urls = text.match(/https?:\/\/[^\s<>"'，。；！？）】》]+/gi) || [];
  for (var i = 0; i < urls.length; i++) {
    var candidate = urls[i].replace(/[),.!?，。；]+$/g, '');
    var parsed = /^https?:\/\/([a-z0-9.-]+)(\/[^?#]*)(\?[^#]*)?(?:#.*)?$/i.exec(candidate);
    if (!parsed) continue;
    var authority = parsed[1].toLowerCase(), path = parsed[2], query = parsed[3] || '';
    if (/^(?:b23\.tv|bili2233\.cn)$/.test(authority) && /^\/[a-z0-9]+\/?$/i.test(path)) {
      return 'https://' + authority + path + query;
    }
    if (!/^(?:(?:www|m)\.)?bilibili\.com$/.test(authority)) continue;
    var video = /^\/video\/(BV1[0-9a-z]{9}|av\d+)\/?$/i.exec(path);
    if (video) {
      var page = /[?&]p=([^&]*)/i.exec(query);
      if (page && (!/^[1-9]\d*$/.test(page[1]) || !Number.isSafeInteger(Number(page[1])))) {
        throw biliLibraryError('partInvalid');
      }
      var target = fromToken(video[1]);
      if (target) return target + (page ? '?p=' + page[1] : '');
    }
    var bangumi = /^\/bangumi\/play\/((?:ep|ss)\d+)\/?$/i.exec(path);
    if (bangumi && fromToken(bangumi[1])) return fromToken(bangumi[1]);
    var media = /^\/bangumi\/media\/(md[1-9]\d*)\/?$/i.exec(path);
    if (media) return 'https://www.bilibili.com/bangumi/media/' + media[1].toLowerCase();
    var season = /[?&]season_id=([1-9]\d*)(?:&|$)/i.exec(query);
    if (season && /^\/bangumi\/(?:play|media)\/?$/i.test(path)) return fromToken('ss' + season[1]);
  }
  if (!urls.length) {
    var token = /(?:^|[^A-Za-z0-9])(BV1[0-9A-Za-z]{9}|(?:av|ep|ss)\d+)(?=$|[^A-Za-z0-9])/i.exec(text);
    if (token && fromToken(token[1])) return fromToken(token[1]);
  }
  throw biliLibraryError('inputInvalid');
}

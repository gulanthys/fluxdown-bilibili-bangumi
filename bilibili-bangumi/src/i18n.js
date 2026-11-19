// Portable view locales come from render(), not from the daemon or view state.
function biliLocale(locale) {
  return /^zh(?:[-_]|$)/i.test(String(locale || '')) ? 'zh' : 'en';
}

function biliText(locale, catalog, key, params) {
  var text = catalog[biliLocale(locale)][key] || catalog.en[key];
  return params ? text.replace(/\{(\w+)\}/g, function (token, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token;
  }) : text;
}

/*
node-qrcode 1.5.4, https://github.com/soldair/node-qrcode
Bundled from FluxDown's existing web dependency, core matrix encoder only.

The MIT License (MIT)

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Bundled dijkstrajs path-finding functions, adapted from the Dijkstar Python project.
Copyright (C) 2008 Wyatt Baldwin <self@wyattbaldwin.com>
All rights reserved.
Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
// Bilibili 登录入口。
//
// 仅支持二维码登录：输入 qr/二维码 开始，随后用同一会话反复 poll。
// 登录成功后的 Cookie 交给 FD 通用 auth 存储，解析阶段由 flux.fetch 自动复用。

var PASSPORT_BASE = 'https://passport.bilibili.com';
var DEFAULT_SITE = 'api.bilibili.com';
var FIXED_SITES = [DEFAULT_SITE, 'passport.bilibili.com', 'www.bilibili.com'];
var QR_TTL_MS = 180000; // Bilibili 二维码通常有效 180 秒。
var SESSION_KEY = 'bilibili.auth.session';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
var COOKIE_NAMES = [
  'sid', 'DedeUserID', 'DedeUserID__ckMd5', 'SESSDATA', 'bili_jct',
  'buvid3', 'buvid4', 'ac_time_value'
];

function jsonInput(raw) {
  var text = String(raw || '').trim();
  if (!text) return {};
  try {
    var value = JSON.parse(text);
    return value && typeof value === 'object' ? value : { value: text };
  } catch (e) {
    return { value: text };
  }
}

function randomId(prefix) {
  var now = Date.now().toString(36);
  var random = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return String(prefix || 'auth') + '-' + now + '-' + random;
}

async function loadSession() {
  try {
    var raw = await flux.storage.get(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function saveSession(session) {
  await flux.storage.set(SESSION_KEY, JSON.stringify(session || {}));
}

async function clearSession() {
  await flux.storage.set(SESSION_KEY, '');
}

function headers(cookie) {
  var result = {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://www.bilibili.com/',
    'User-Agent': USER_AGENT,
  };
  if (cookie) result.Cookie = cookie;
  return result;
}

async function request(method, url, options) {
  var opts = options || {};
  var response = await flux.fetch({
    method: method,
    url: url,
    headers: opts.headers || headers(opts.cookie || ''),
    body: opts.body,
    authRef: opts.authRef,
  });
  var payload = null;
  try {
    payload = JSON.parse(response.body || '');
  } catch (e) {
    throw new Error('Bilibili 登录接口返回非法 JSON: HTTP ' + String(response.status));
  }
  return { response: response, payload: payload || {} };
}

function responseHeader(response, name) {
  var all = response && response.headers ? response.headers : {};
  var keys = Object.keys(all);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === String(name).toLowerCase()) return String(all[keys[i]] || '');
  }
  return '';
}

function decode(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, ' ')); } catch (e) { return String(value || ''); }
}

function decodeCookie(value) {
  // Cookie 值中的 + 是字面量，不能按 querystring 的空格规则处理。
  // Cookie header values must be preserved verbatim. In particular, Bilibili
  // expects SESSDATA's %2C and %2A escapes to remain encoded.
  return String(value || '').trim();
}

function cookieQueryValue(name, value) {
  // SESSDATA can be embedded in a callback URL, where decoding it changes the
  // value that Bilibili uses to determine the account's playback privileges.
  if (String(name || '').toLowerCase() === 'sessdata') return String(value || '').trim();
  return decode(value);
}

function cookieMap(cookie) {
  var map = {};
  var text = String(cookie || '');
  for (var i = 0; i < COOKIE_NAMES.length; i++) {
    var name = COOKIE_NAMES[i];
    var pattern = new RegExp('(?:^|[;\\n,]\\s*)' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '=([^;\\n,]*)', 'i');
    var match = pattern.exec(text);
    if (match && match[1]) map[name] = decodeCookie(match[1].trim());
  }
  return map;
}

function mergeCookieParts(parts) {
  var map = {};
  for (var i = 0; i < (parts || []).length; i++) {
    var current = cookieMap(parts[i]);
    var names = Object.keys(current);
    for (var j = 0; j < names.length; j++) map[names[j]] = current[names[j]];
  }
  var output = [];
  for (var k = 0; k < COOKIE_NAMES.length; k++) {
    var name = COOKIE_NAMES[k];
    if (map[name]) output.push(name + '=' + map[name]);
  }
  return output.join('; ');
}

function cookiesFromResult(result, existing) {
  var response = result && result.response ? result.response : {};
  var payload = result && result.payload ? result.payload : {};
  var data = payload.data || {};
  var parts = [existing, responseHeader(response, 'set-cookie'), responseHeader(response, 'cookie')];
  var urls = [data.url, data.redirectUrl, data.goUrl];
  for (var i = 0; i < urls.length; i++) {
    var url = String(urls[i] || '');
    if (!url) continue;
    var query = /[?&]([^=#]+)=([^&#]*)/g;
    var match;
    while ((match = query.exec(url)) !== null) {
      var key = decode(match[1]);
      for (var n = 0; n < COOKIE_NAMES.length; n++) {
        if (key === COOKIE_NAMES[n]) parts.push(key + '=' + cookieQueryValue(key, match[2]));
      }
    }
  }
  return mergeCookieParts(parts);
}

function apiError(payload) {
  var topLevel = Number(payload && payload.code);
  var nested = Number(payload && payload.data && payload.data.code);
  // Bilibili 二维码轮询接口外层 code 固定为 0，真正的扫码状态在 data.code。
  return nested || topLevel || 0;
}

function resultError(payload) {
  return 'Bilibili 登录失败 code=' + String(apiError(payload)) + ': ' +
    String((payload && payload.data && payload.data.message) || (payload && payload.message) || 'unknown');
}

function normalizedSite(site) {
  var value = String(site || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return value ? 'https://' + value : '';
}

function canonicalRef(site) {
  var normalized = normalizedSite(site);
  return normalized ? 'gulanthys@bilibili-bangumi::' + normalized : '';
}

function normalizeRef(ref) {
  var value = String(ref || '');
  var separator = value.indexOf('::');
  return separator < 0 ? value : canonicalRef(value.slice(separator + 2));
}

async function storedRefs() {
  var refs = [];
  try {
    var raw = await flux.storage.get('auth.refs');
    var parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) refs = parsed.map(normalizeRef).filter(Boolean);
  } catch (e) {}
  if (!refs.length) refs = FIXED_SITES.map(canonicalRef);
  return refs;
}

async function saveAuth(cookie, account) {
  if (!cookie) throw new Error('Bilibili 登录成功但未取得 Cookie，请重新扫码');
  if (!/(?:^|;\s*)SESSDATA=/i.test(cookie)) throw new Error('Bilibili 登录成功但未取得 SESSDATA，请重新扫码');
  var sites = FIXED_SITES.slice();
  var requested = normalizedSite(account && account.site);
  if (requested && sites.map(normalizedSite).indexOf(requested) < 0) sites.push(requested);
  var refs = [];
  var primaryError = null;
  for (var i = 0; i < sites.length; i++) {
    var site = normalizedSite(sites[i]);
    try {
      var ref = await flux.auth.save({
        site: site,
        kind: 'cookie',
        account: String(account && account.username || ''),
        cookies: cookie,
        refreshToken: '',
        metadata: { provider: 'bilibili', login: 'qrcode' },
      });
      if (ref) refs.push(String(ref));
      else if (site === normalizedSite(DEFAULT_SITE)) primaryError = new Error('FD 未返回认证引用');
    } catch (e) {
      if (site === normalizedSite(DEFAULT_SITE)) primaryError = e;
    }
  }
  try {
    await flux.storage.set('auth.refs', JSON.stringify(refs));
  } catch (e) {
    throw new Error('登录成功，但无法保存认证引用索引');
  }
  try { await flux.storage.set('auth.cookie', ''); } catch (e) {
    throw new Error('认证档案已保存，但无法清理旧 Cookie 缓存');
  }
  if (primaryError) throw new Error('登录成功，但 FD 未能保存 api.bilibili.com 认证档案');
  return refs[0] || canonicalRef(DEFAULT_SITE);
}

async function logoutAuth(authRef) {
  var refs = await storedRefs();
  var requestedRef = normalizeRef(authRef);
  if (requestedRef && refs.indexOf(requestedRef) < 0) refs.push(requestedRef);
  var failed = [];
  var errors = [];
  for (var i = 0; i < refs.length; i++) {
    try { await flux.auth.remove(String(refs[i])); } catch (e) {
      failed.push(String(refs[i]));
      errors.push(String(e && e.message || e));
    }
  }
  try { await flux.storage.set('auth.refs', JSON.stringify(failed)); } catch (e) {
    throw new Error('注销失败，且无法保存未删除认证引用：' + String(e && e.message || e));
  }
  try { await flux.storage.set('auth.cookie', ''); } catch (e) {
    errors.push('旧 Cookie 缓存清理失败：' + String(e && e.message || e));
  }
  try { await clearSession(); } catch (e) { errors.push('登录会话清理失败：' + String(e && e.message || e)); }
  if (failed.length || errors.length) return {
    status: 'error', sessionId: '', authRef: null,
    message: 'Bilibili 注销未完成：' + errors.join('; '),
  };
  return { status: 'success', sessionId: '', authRef: null, message: 'Bilibili 已注销，认证状态已清除。' };
}

async function statusAuth() {
  var session = await loadSession();
  if (session && session.kind === 'qrcode' && session.challenge) {
    if (Date.now() - Number(session.createdAt || 0) >= QR_TTL_MS) {
      await clearSession();
    } else {
      return pendingResult(
        session,
        session.challenge,
        '请用 Bilibili App 扫描上面的二维码；系统会自动检查登录状态。',
        'qrcode',
      );
    }
  }
  var apiRef = canonicalRef(DEFAULT_SITE);
  var refs = await storedRefs();
  if (refs.indexOf(apiRef) < 0) return { status: 'error', sessionId: '', message: '' };
  var profile;
  try {
    profile = await flux.auth.get(apiRef);
  } catch (e) {
    return { status: 'error', sessionId: '', message: '无法检查 Bilibili 登录状态，请稍后重试。' };
  }
  var expiresAt = Number(profile && profile.expiresAt) || 0;
  var cookie = String(profile && profile.cookies || '');
  if (!profile || (expiresAt && expiresAt <= Math.floor(Date.now() / 1000)) ||
      !/(?:^|;\s*)SESSDATA=/i.test(cookie)) {
    return { status: 'error', sessionId: '', message: 'Bilibili 登录已失效，请重新扫码登录。' };
  }
  try {
    var result = await request('GET', 'https://api.bilibili.com/x/web-interface/nav', {
      cookie: cookie,
      authRef: apiRef,
    });
    if (Number(result.response.status) < 200 || Number(result.response.status) >= 300) {
      return { status: 'error', sessionId: '', message: '无法检查 Bilibili 登录状态，请稍后重试。' };
    }
    var code = Number(result.payload.code);
    if (code === -101 || (code === 0 && result.payload.data && result.payload.data.isLogin === false)) {
      return { status: 'error', sessionId: '', message: 'Bilibili 登录已失效，请重新扫码登录。' };
    }
    if (code !== 0 || !result.payload.data || result.payload.data.isLogin !== true) {
      return { status: 'error', sessionId: '', message: '无法检查 Bilibili 登录状态，请稍后重试。' };
    }
    return successResult('', apiRef);
  } catch (e) {
    return { status: 'error', sessionId: '', message: '无法检查 Bilibili 登录状态，请稍后重试。' };
  }
}


function successResult(sessionId, authRef) {
  return {
    status: 'success',
    sessionId: sessionId || '',
    authRef: authRef || null,
    message: 'Bilibili 登录成功，认证状态已保存，后续解析会自动复用。',
  };
}

function pendingResult(session, challenge, message, type) {
  return {
    status: 'pending',
    sessionId: session.id,
    challenge: challenge || null,
    challengeType: type || session.kind,
    message: message || '请完成验证后继续。',
  };
}

var BILI_QR_MESSAGES = {
  scan: '等待扫码确认。',
  confirm: '已扫描，请在 Bilibili App 确认登录。',
  expired: '二维码已过期，请重新开始二维码登录。',
};

async function beginQr(ctx) {
  var result = await request('GET', PASSPORT_BASE + '/x/passport-login/web/qrcode/generate', {});
  if (apiError(result.payload) !== 0 || !result.payload.data) throw new Error(resultError(result.payload));
  var data = result.payload.data;
  var session = {
    id: randomId('qr'),
    kind: 'qrcode',
    qrcodeKey: String(data.qrcode_key || ''),
    challenge: String(data.url || ''),
    cookie: cookiesFromResult(result, ''),
    createdAt: Date.now(),
    site: ctx.site || DEFAULT_SITE,
  };
  if (!session.qrcodeKey || !session.challenge) throw new Error('Bilibili 未返回有效二维码');
  await saveSession(session);
  return pendingResult(session, session.challenge, '请用 Bilibili App 扫描上面的二维码；系统会自动检查登录状态。', 'qrcode');
}

async function pollQr(session) {
  if (Date.now() - Number(session.createdAt || 0) >= QR_TTL_MS) {
    await clearSession();
    return { status: 'error', sessionId: '', message: BILI_QR_MESSAGES.expired };
  }
  var result = await request('GET', PASSPORT_BASE + '/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(session.qrcodeKey), {
    cookie: session.cookie || '',
  });
  var code = apiError(result.payload);
  if (code === 86101 || code === 86090) {
    session.cookie = cookiesFromResult(result, session.cookie);
    await saveSession(session);
    return pendingResult(session, session.challenge, BILI_QR_MESSAGES[code === 86090 ? 'confirm' : 'scan'], 'qrcode');
  }
  if (code === 86038) {
    await clearSession();
    return { status: 'error', sessionId: '', message: BILI_QR_MESSAGES.expired };
  }
  if (code !== 0) throw new Error(resultError(result.payload));
  var cookie = cookiesFromResult(result, session.cookie);
  var authRef = await saveAuth(cookie, { site: session.site, username: '' });
  await clearSession();
  return successResult(session.id, authRef);
}

globalThis.authenticate = async (ctx) => {
  var input = jsonInput(ctx && ctx.input);
  if (ctx && ctx.action === 'status') {
    return await statusAuth();
  }
  if (ctx && ctx.action === 'logout') {
    return await logoutAuth(String(ctx.authRef || ''));
  }
  if (ctx && ctx.action === 'cancel') {
    await clearSession();
    return { status: 'error', sessionId: String(ctx.sessionId || ''), message: '已取消 Bilibili 登录。' };
  }
  if (ctx && ctx.action === 'begin') {
    var mode = String(input.mode || input.value || '').toLowerCase();
    if (!mode || mode === 'qr' || mode === 'qrcode' || mode === '二维码') return await beginQr(ctx || {});
    return { status: 'error', sessionId: '', message: '当前仅支持二维码登录，请使用二维码登录。' };
  }
  var session = await loadSession();
  if (!session || (ctx && ctx.sessionId && session.id !== ctx.sessionId)) {
    throw new Error('Bilibili 登录会话不存在或已过期，请重新开始。');
  }
  if (session.kind !== 'qrcode') {
    await clearSession();
    return { status: 'error', sessionId: String(session.id || ''), message: '当前仅支持二维码登录，请重新开始。' };
  }
  return await pollQr(session);
};

var BilibiliQr=(()=>{var Ce=Object.create;var Y=Object.defineProperty;var me=Object.getOwnPropertyDescriptor;var ye=Object.getOwnPropertyNames;var Be=Object.getPrototypeOf,Ae=Object.prototype.hasOwnProperty;var g=(n,t)=>()=>(t||n((t={exports:{}}).exports,t),t.exports),Ne=(n,t)=>{for(var e in t)Y(n,e,{get:t[e],enumerable:!0})},Tt=(n,t,e,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of ye(t))!Ae.call(n,o)&&o!==e&&Y(n,o,{get:()=>t[o],enumerable:!(r=me(t,o))||r.enumerable});return n};var Te=(n,t,e)=>(e=n!=null?Ce(Be(n)):{},Tt(t||!n||!n.__esModule?Y(e,"default",{value:n,enumerable:!0}):e,n)),Ie=n=>Tt(Y({},"__esModule",{value:!0}),n);var B=g(I=>{var ot,Me=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];I.getSymbolSize=function(t){if(!t)throw new Error('"version" cannot be null or undefined');if(t<1||t>40)throw new Error('"version" should be in range from 1 to 40');return t*4+17};I.getSymbolTotalCodewords=function(t){return Me[t]};I.getBCHDigit=function(n){let t=0;for(;n!==0;)t++,n>>>=1;return t};I.setToSJISFunction=function(t){if(typeof t!="function")throw new Error('"toSJISFunc" is not a valid function.');ot=t};I.isKanjiModeEnabled=function(){return typeof ot<"u"};I.toSJIS=function(t){return ot(t)}});var G=g(w=>{w.L={bit:1};w.M={bit:0};w.Q={bit:3};w.H={bit:2};function Se(n){if(typeof n!="string")throw new Error("Param is not a string");switch(n.toLowerCase()){case"l":case"low":return w.L;case"m":case"medium":return w.M;case"q":case"quartile":return w.Q;case"h":case"high":return w.H;default:throw new Error("Unknown EC Level: "+n)}}w.isValid=function(t){return t&&typeof t.bit<"u"&&t.bit>=0&&t.bit<4};w.from=function(t,e){if(w.isValid(t))return t;try{return Se(t)}catch{return e}}});var St=g((Cn,Mt)=>{function It(){this.buffer=[],this.length=0}It.prototype={get:function(n){let t=Math.floor(n/8);return(this.buffer[t]>>>7-n%8&1)===1},put:function(n,t){for(let e=0;e<t;e++)this.putBit((n>>>t-e-1&1)===1)},getLengthInBits:function(){return this.length},putBit:function(n){let t=Math.floor(this.length/8);this.buffer.length<=t&&this.buffer.push(0),n&&(this.buffer[t]|=128>>>this.length%8),this.length++}};Mt.exports=It});var bt=g((mn,Pt)=>{function D(n){if(!n||n<1)throw new Error("BitMatrix size must be defined and greater than 0");this.size=n,this.data=new Uint8Array(n*n),this.reservedBit=new Uint8Array(n*n)}D.prototype.set=function(n,t,e,r){let o=n*this.size+t;this.data[o]=e,r&&(this.reservedBit[o]=!0)};D.prototype.get=function(n,t){return this.data[n*this.size+t]};D.prototype.xor=function(n,t,e){this.data[n*this.size+t]^=e};D.prototype.isReserved=function(n,t){return this.reservedBit[n*this.size+t]};Pt.exports=D});var Rt=g(O=>{var Pe=B().getSymbolSize;O.getRowColCoords=function(t){if(t===1)return[];let e=Math.floor(t/7)+2,r=Pe(t),o=r===145?26:Math.ceil((r-13)/(2*e-2))*2,i=[r-7];for(let s=1;s<e-1;s++)i[s]=i[s-1]-o;return i.push(6),i.reverse()};O.getPositions=function(t){let e=[],r=O.getRowColCoords(t),o=r.length;for(let i=0;i<o;i++)for(let s=0;s<o;s++)i===0&&s===0||i===0&&s===o-1||i===o-1&&s===0||e.push([r[i],r[s]]);return e}});var xt=g(_t=>{var be=B().getSymbolSize,Lt=7;_t.getPositions=function(t){let e=be(t);return[[0,0],[e-Lt,0],[0,e-Lt]]}});var Ut=g(f=>{f.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};var M={N1:3,N2:3,N3:40,N4:10};f.isValid=function(t){return t!=null&&t!==""&&!isNaN(t)&&t>=0&&t<=7};f.from=function(t){return f.isValid(t)?parseInt(t,10):void 0};f.getPenaltyN1=function(t){let e=t.size,r=0,o=0,i=0,s=null,u=null;for(let c=0;c<e;c++){o=i=0,s=u=null;for(let l=0;l<e;l++){let d=t.get(c,l);d===s?o++:(o>=5&&(r+=M.N1+(o-5)),s=d,o=1),d=t.get(l,c),d===u?i++:(i>=5&&(r+=M.N1+(i-5)),u=d,i=1)}o>=5&&(r+=M.N1+(o-5)),i>=5&&(r+=M.N1+(i-5))}return r};f.getPenaltyN2=function(t){let e=t.size,r=0;for(let o=0;o<e-1;o++)for(let i=0;i<e-1;i++){let s=t.get(o,i)+t.get(o,i+1)+t.get(o+1,i)+t.get(o+1,i+1);(s===4||s===0)&&r++}return r*M.N2};f.getPenaltyN3=function(t){let e=t.size,r=0,o=0,i=0;for(let s=0;s<e;s++){o=i=0;for(let u=0;u<e;u++)o=o<<1&2047|t.get(s,u),u>=10&&(o===1488||o===93)&&r++,i=i<<1&2047|t.get(u,s),u>=10&&(i===1488||i===93)&&r++}return r*M.N3};f.getPenaltyN4=function(t){let e=0,r=t.data.length;for(let i=0;i<r;i++)e+=t.data[i];return Math.abs(Math.ceil(e*100/r/5)-10)*M.N4};function Re(n,t,e){switch(n){case f.Patterns.PATTERN000:return(t+e)%2===0;case f.Patterns.PATTERN001:return t%2===0;case f.Patterns.PATTERN010:return e%3===0;case f.Patterns.PATTERN011:return(t+e)%3===0;case f.Patterns.PATTERN100:return(Math.floor(t/2)+Math.floor(e/3))%2===0;case f.Patterns.PATTERN101:return t*e%2+t*e%3===0;case f.Patterns.PATTERN110:return(t*e%2+t*e%3)%2===0;case f.Patterns.PATTERN111:return(t*e%3+(t+e)%2)%2===0;default:throw new Error("bad maskPattern:"+n)}}f.applyMask=function(t,e){let r=e.size;for(let o=0;o<r;o++)for(let i=0;i<r;i++)e.isReserved(i,o)||e.xor(i,o,Re(t,i,o))};f.getBestMask=function(t,e){let r=Object.keys(f.Patterns).length,o=0,i=1/0;for(let s=0;s<r;s++){e(s),f.applyMask(s,t);let u=f.getPenaltyN1(t)+f.getPenaltyN2(t)+f.getPenaltyN3(t)+f.getPenaltyN4(t);f.applyMask(s,t),u<i&&(i=u,o=s)}return o}});var st=g(it=>{var A=G(),Q=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],j=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];it.getBlocksCount=function(t,e){switch(e){case A.L:return Q[(t-1)*4+0];case A.M:return Q[(t-1)*4+1];case A.Q:return Q[(t-1)*4+2];case A.H:return Q[(t-1)*4+3];default:return}};it.getTotalCodewordsCount=function(t,e){switch(e){case A.L:return j[(t-1)*4+0];case A.M:return j[(t-1)*4+1];case A.Q:return j[(t-1)*4+2];case A.H:return j[(t-1)*4+3];default:return}}});var qt=g(Z=>{var F=new Uint8Array(512),$=new Uint8Array(256);(function(){let t=1;for(let e=0;e<255;e++)F[e]=t,$[t]=e,t<<=1,t&256&&(t^=285);for(let e=255;e<512;e++)F[e]=F[e-255]})();Z.log=function(t){if(t<1)throw new Error("log("+t+")");return $[t]};Z.exp=function(t){return F[t]};Z.mul=function(t,e){return t===0||e===0?0:F[$[t]+$[e]]}});var Dt=g(k=>{var ut=qt();k.mul=function(t,e){let r=new Uint8Array(t.length+e.length-1);for(let o=0;o<t.length;o++)for(let i=0;i<e.length;i++)r[o+i]^=ut.mul(t[o],e[i]);return r};k.mod=function(t,e){let r=new Uint8Array(t);for(;r.length-e.length>=0;){let o=r[0];for(let s=0;s<e.length;s++)r[s]^=ut.mul(e[s],o);let i=0;for(;i<r.length&&r[i]===0;)i++;r=r.slice(i)}return r};k.generateECPolynomial=function(t){let e=new Uint8Array([1]);for(let r=0;r<t;r++)e=k.mul(e,new Uint8Array([1,ut.exp(r)]));return e}});var zt=g((Mn,kt)=>{var Ft=Dt();function ct(n){this.genPoly=void 0,this.degree=n,this.degree&&this.initialize(this.degree)}ct.prototype.initialize=function(t){this.degree=t,this.genPoly=Ft.generateECPolynomial(this.degree)};ct.prototype.encode=function(t){if(!this.genPoly)throw new Error("Encoder not initialized");let e=new Uint8Array(t.length+this.degree);e.set(t);let r=Ft.mod(e,this.genPoly),o=this.degree-r.length;if(o>0){let i=new Uint8Array(this.degree);return i.set(r,o),i}return r};kt.exports=ct});var at=g(Vt=>{Vt.isValid=function(t){return!isNaN(t)&&t>=1&&t<=40}});var lt=g(m=>{var Ht="[0-9]+",Le="[A-Z $%*+\\-./:]+",z="(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";z=z.replace(/u/g,"\\u");var _e="(?:(?![A-Z0-9 $%*+\\-./:]|"+z+`)(?:.|[\r
]))+`;m.KANJI=new RegExp(z,"g");m.BYTE_KANJI=new RegExp("[^A-Z0-9 $%*+\\-./:]+","g");m.BYTE=new RegExp(_e,"g");m.NUMERIC=new RegExp(Ht,"g");m.ALPHANUMERIC=new RegExp(Le,"g");var xe=new RegExp("^"+z+"$"),Ue=new RegExp("^"+Ht+"$"),qe=new RegExp("^[A-Z0-9 $%*+\\-./:]+$");m.testKanji=function(t){return xe.test(t)};m.testNumeric=function(t){return Ue.test(t)};m.testAlphanumeric=function(t){return qe.test(t)}});var N=g(h=>{var De=at(),ft=lt();h.NUMERIC={id:"Numeric",bit:1,ccBits:[10,12,14]};h.ALPHANUMERIC={id:"Alphanumeric",bit:2,ccBits:[9,11,13]};h.BYTE={id:"Byte",bit:4,ccBits:[8,16,16]};h.KANJI={id:"Kanji",bit:8,ccBits:[8,10,12]};h.MIXED={bit:-1};h.getCharCountIndicator=function(t,e){if(!t.ccBits)throw new Error("Invalid mode: "+t);if(!De.isValid(e))throw new Error("Invalid version: "+e);return e>=1&&e<10?t.ccBits[0]:e<27?t.ccBits[1]:t.ccBits[2]};h.getBestModeForData=function(t){return ft.testNumeric(t)?h.NUMERIC:ft.testAlphanumeric(t)?h.ALPHANUMERIC:ft.testKanji(t)?h.KANJI:h.BYTE};h.toString=function(t){if(t&&t.id)return t.id;throw new Error("Invalid mode")};h.isValid=function(t){return t&&t.bit&&t.ccBits};function Fe(n){if(typeof n!="string")throw new Error("Param is not a string");switch(n.toLowerCase()){case"numeric":return h.NUMERIC;case"alphanumeric":return h.ALPHANUMERIC;case"kanji":return h.KANJI;case"byte":return h.BYTE;default:throw new Error("Unknown mode: "+n)}}h.from=function(t,e){if(h.isValid(t))return t;try{return Fe(t)}catch{return e}}});var Ot=g(S=>{var X=B(),ke=st(),Kt=G(),T=N(),gt=at(),Yt=7973,Jt=X.getBCHDigit(Yt);function ze(n,t,e){for(let r=1;r<=40;r++)if(t<=S.getCapacity(r,e,n))return r}function Gt(n,t){return T.getCharCountIndicator(n,t)+4}function Ve(n,t){let e=0;return n.forEach(function(r){let o=Gt(r.mode,t);e+=o+r.getBitsLength()}),e}function He(n,t){for(let e=1;e<=40;e++)if(Ve(n,e)<=S.getCapacity(e,t,T.MIXED))return e}S.from=function(t,e){return gt.isValid(t)?parseInt(t,10):e};S.getCapacity=function(t,e,r){if(!gt.isValid(t))throw new Error("Invalid QR Code version");typeof r>"u"&&(r=T.BYTE);let o=X.getSymbolTotalCodewords(t),i=ke.getTotalCodewordsCount(t,e),s=(o-i)*8;if(r===T.MIXED)return s;let u=s-Gt(r,t);switch(r){case T.NUMERIC:return Math.floor(u/10*3);case T.ALPHANUMERIC:return Math.floor(u/11*2);case T.KANJI:return Math.floor(u/13);case T.BYTE:default:return Math.floor(u/8)}};S.getBestVersionForData=function(t,e){let r,o=Kt.from(e,Kt.M);if(Array.isArray(t)){if(t.length>1)return He(t,o);if(t.length===0)return 1;r=t[0]}else r=t;return ze(r.mode,r.getLength(),o)};S.getEncodedBits=function(t){if(!gt.isValid(t)||t<7)throw new Error("Invalid QR Code version");let e=t<<12;for(;X.getBCHDigit(e)-Jt>=0;)e^=Yt<<X.getBCHDigit(e)-Jt;return t<<12|e}});var Zt=g($t=>{var dt=B(),jt=1335,Ke=21522,Qt=dt.getBCHDigit(jt);$t.getEncodedBits=function(t,e){let r=t.bit<<3|e,o=r<<10;for(;dt.getBCHDigit(o)-Qt>=0;)o^=jt<<dt.getBCHDigit(o)-Qt;return(r<<10|o)^Ke}});var vt=g((_n,Xt)=>{var Je=N();function L(n){this.mode=Je.NUMERIC,this.data=n.toString()}L.getBitsLength=function(t){return 10*Math.floor(t/3)+(t%3?t%3*3+1:0)};L.prototype.getLength=function(){return this.data.length};L.prototype.getBitsLength=function(){return L.getBitsLength(this.data.length)};L.prototype.write=function(t){let e,r,o;for(e=0;e+3<=this.data.length;e+=3)r=this.data.substr(e,3),o=parseInt(r,10),t.put(o,10);let i=this.data.length-e;i>0&&(r=this.data.substr(e),o=parseInt(r,10),t.put(o,i*3+1))};Xt.exports=L});var te=g((xn,Wt)=>{var Ye=N(),ht=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"," ","$","%","*","+","-",".","/",":"];function _(n){this.mode=Ye.ALPHANUMERIC,this.data=n}_.getBitsLength=function(t){return 11*Math.floor(t/2)+6*(t%2)};_.prototype.getLength=function(){return this.data.length};_.prototype.getBitsLength=function(){return _.getBitsLength(this.data.length)};_.prototype.write=function(t){let e;for(e=0;e+2<=this.data.length;e+=2){let r=ht.indexOf(this.data[e])*45;r+=ht.indexOf(this.data[e+1]),t.put(r,11)}this.data.length%2&&t.put(ht.indexOf(this.data[e]),6)};Wt.exports=_});var ne=g((Un,ee)=>{var Ge=N();function x(n){this.mode=Ge.BYTE,typeof n=="string"?this.data=new TextEncoder().encode(n):this.data=new Uint8Array(n)}x.getBitsLength=function(t){return t*8};x.prototype.getLength=function(){return this.data.length};x.prototype.getBitsLength=function(){return x.getBitsLength(this.data.length)};x.prototype.write=function(n){for(let t=0,e=this.data.length;t<e;t++)n.put(this.data[t],8)};ee.exports=x});var oe=g((qn,re)=>{var Oe=N(),Qe=B();function U(n){this.mode=Oe.KANJI,this.data=n}U.getBitsLength=function(t){return t*13};U.prototype.getLength=function(){return this.data.length};U.prototype.getBitsLength=function(){return U.getBitsLength(this.data.length)};U.prototype.write=function(n){let t;for(t=0;t<this.data.length;t++){let e=Qe.toSJIS(this.data[t]);if(e>=33088&&e<=40956)e-=33088;else if(e>=57408&&e<=60351)e-=49472;else throw new Error("Invalid SJIS character: "+this.data[t]+`
Make sure your charset is UTF-8`);e=(e>>>8&255)*192+(e&255),n.put(e,13)}};re.exports=U});var ie=g((Dn,pt)=>{"use strict";var V={single_source_shortest_paths:function(n,t,e){var r={},o={};o[t]=0;var i=V.PriorityQueue.make();i.push(t,0);for(var s,u,c,l,d,y,p,J,P;!i.empty();){s=i.pop(),u=s.value,l=s.cost,d=n[u]||{};for(c in d)d.hasOwnProperty(c)&&(y=d[c],p=l+y,J=o[c],P=typeof o[c]>"u",(P||J>p)&&(o[c]=p,i.push(c,p),r[c]=u))}if(typeof e<"u"&&typeof o[e]>"u"){var b=["Could not find a path from ",t," to ",e,"."].join("");throw new Error(b)}return r},extract_shortest_path_from_predecessor_list:function(n,t){for(var e=[],r=t,o;r;)e.push(r),o=n[r],r=n[r];return e.reverse(),e},find_path:function(n,t,e){var r=V.single_source_shortest_paths(n,t,e);return V.extract_shortest_path_from_predecessor_list(r,e)},PriorityQueue:{make:function(n){var t=V.PriorityQueue,e={},r;n=n||{};for(r in t)t.hasOwnProperty(r)&&(e[r]=t[r]);return e.queue=[],e.sorter=n.sorter||t.default_sorter,e},default_sorter:function(n,t){return n.cost-t.cost},push:function(n,t){var e={value:n,cost:t};this.queue.push(e),this.queue.sort(this.sorter)},pop:function(){return this.queue.shift()},empty:function(){return this.queue.length===0}}};typeof pt<"u"&&(pt.exports=V)});var de=g(q=>{var a=N(),ce=vt(),ae=te(),le=ne(),fe=oe(),H=lt(),v=B(),je=ie();function se(n){return unescape(encodeURIComponent(n)).length}function K(n,t,e){let r=[],o;for(;(o=n.exec(e))!==null;)r.push({data:o[0],index:o.index,mode:t,length:o[0].length});return r}function ge(n){let t=K(H.NUMERIC,a.NUMERIC,n),e=K(H.ALPHANUMERIC,a.ALPHANUMERIC,n),r,o;return v.isKanjiModeEnabled()?(r=K(H.BYTE,a.BYTE,n),o=K(H.KANJI,a.KANJI,n)):(r=K(H.BYTE_KANJI,a.BYTE,n),o=[]),t.concat(e,r,o).sort(function(s,u){return s.index-u.index}).map(function(s){return{data:s.data,mode:s.mode,length:s.length}})}function wt(n,t){switch(t){case a.NUMERIC:return ce.getBitsLength(n);case a.ALPHANUMERIC:return ae.getBitsLength(n);case a.KANJI:return fe.getBitsLength(n);case a.BYTE:return le.getBitsLength(n)}}function $e(n){return n.reduce(function(t,e){let r=t.length-1>=0?t[t.length-1]:null;return r&&r.mode===e.mode?(t[t.length-1].data+=e.data,t):(t.push(e),t)},[])}function Ze(n){let t=[];for(let e=0;e<n.length;e++){let r=n[e];switch(r.mode){case a.NUMERIC:t.push([r,{data:r.data,mode:a.ALPHANUMERIC,length:r.length},{data:r.data,mode:a.BYTE,length:r.length}]);break;case a.ALPHANUMERIC:t.push([r,{data:r.data,mode:a.BYTE,length:r.length}]);break;case a.KANJI:t.push([r,{data:r.data,mode:a.BYTE,length:se(r.data)}]);break;case a.BYTE:t.push([{data:r.data,mode:a.BYTE,length:se(r.data)}])}}return t}function Xe(n,t){let e={},r={start:{}},o=["start"];for(let i=0;i<n.length;i++){let s=n[i],u=[];for(let c=0;c<s.length;c++){let l=s[c],d=""+i+c;u.push(d),e[d]={node:l,lastCount:0},r[d]={};for(let y=0;y<o.length;y++){let p=o[y];e[p]&&e[p].node.mode===l.mode?(r[p][d]=wt(e[p].lastCount+l.length,l.mode)-wt(e[p].lastCount,l.mode),e[p].lastCount+=l.length):(e[p]&&(e[p].lastCount=l.length),r[p][d]=wt(l.length,l.mode)+4+a.getCharCountIndicator(l.mode,t))}}o=u}for(let i=0;i<o.length;i++)r[o[i]].end=0;return{map:r,table:e}}function ue(n,t){let e,r=a.getBestModeForData(n);if(e=a.from(t,r),e!==a.BYTE&&e.bit<r.bit)throw new Error('"'+n+'" cannot be encoded with mode '+a.toString(e)+`.
 Suggested mode is: `+a.toString(r));switch(e===a.KANJI&&!v.isKanjiModeEnabled()&&(e=a.BYTE),e){case a.NUMERIC:return new ce(n);case a.ALPHANUMERIC:return new ae(n);case a.KANJI:return new fe(n);case a.BYTE:return new le(n)}}q.fromArray=function(t){return t.reduce(function(e,r){return typeof r=="string"?e.push(ue(r,null)):r.data&&e.push(ue(r.data,r.mode)),e},[])};q.fromString=function(t,e){let r=ge(t,v.isKanjiModeEnabled()),o=Ze(r),i=Xe(o,e),s=je.find_path(i.map,"start","end"),u=[];for(let c=1;c<s.length-1;c++)u.push(i.table[s[c]].node);return q.fromArray($e(u))};q.rawSplit=function(t){return q.fromArray(ge(t,v.isKanjiModeEnabled()))}});var pe=g(he=>{var tt=B(),Et=G(),ve=St(),We=bt(),tn=Rt(),en=xt(),yt=Ut(),Bt=st(),nn=zt(),W=Ot(),rn=Zt(),on=N(),Ct=de();function sn(n,t){let e=n.size,r=en.getPositions(t);for(let o=0;o<r.length;o++){let i=r[o][0],s=r[o][1];for(let u=-1;u<=7;u++)if(!(i+u<=-1||e<=i+u))for(let c=-1;c<=7;c++)s+c<=-1||e<=s+c||(u>=0&&u<=6&&(c===0||c===6)||c>=0&&c<=6&&(u===0||u===6)||u>=2&&u<=4&&c>=2&&c<=4?n.set(i+u,s+c,!0,!0):n.set(i+u,s+c,!1,!0))}}function un(n){let t=n.size;for(let e=8;e<t-8;e++){let r=e%2===0;n.set(e,6,r,!0),n.set(6,e,r,!0)}}function cn(n,t){let e=tn.getPositions(t);for(let r=0;r<e.length;r++){let o=e[r][0],i=e[r][1];for(let s=-2;s<=2;s++)for(let u=-2;u<=2;u++)s===-2||s===2||u===-2||u===2||s===0&&u===0?n.set(o+s,i+u,!0,!0):n.set(o+s,i+u,!1,!0)}}function an(n,t){let e=n.size,r=W.getEncodedBits(t),o,i,s;for(let u=0;u<18;u++)o=Math.floor(u/3),i=u%3+e-8-3,s=(r>>u&1)===1,n.set(o,i,s,!0),n.set(i,o,s,!0)}function mt(n,t,e){let r=n.size,o=rn.getEncodedBits(t,e),i,s;for(i=0;i<15;i++)s=(o>>i&1)===1,i<6?n.set(i,8,s,!0):i<8?n.set(i+1,8,s,!0):n.set(r-15+i,8,s,!0),i<8?n.set(8,r-i-1,s,!0):i<9?n.set(8,15-i-1+1,s,!0):n.set(8,15-i-1,s,!0);n.set(r-8,8,1,!0)}function ln(n,t){let e=n.size,r=-1,o=e-1,i=7,s=0;for(let u=e-1;u>0;u-=2)for(u===6&&u--;;){for(let c=0;c<2;c++)if(!n.isReserved(o,u-c)){let l=!1;s<t.length&&(l=(t[s]>>>i&1)===1),n.set(o,u-c,l),i--,i===-1&&(s++,i=7)}if(o+=r,o<0||e<=o){o-=r,r=-r;break}}}function fn(n,t,e){let r=new ve;e.forEach(function(c){r.put(c.mode.bit,4),r.put(c.getLength(),on.getCharCountIndicator(c.mode,n)),c.write(r)});let o=tt.getSymbolTotalCodewords(n),i=Bt.getTotalCodewordsCount(n,t),s=(o-i)*8;for(r.getLengthInBits()+4<=s&&r.put(0,4);r.getLengthInBits()%8!==0;)r.putBit(0);let u=(s-r.getLengthInBits())/8;for(let c=0;c<u;c++)r.put(c%2?17:236,8);return gn(r,n,t)}function gn(n,t,e){let r=tt.getSymbolTotalCodewords(t),o=Bt.getTotalCodewordsCount(t,e),i=r-o,s=Bt.getBlocksCount(t,e),u=r%s,c=s-u,l=Math.floor(r/s),d=Math.floor(i/s),y=d+1,p=l-d,J=new nn(p),P=0,b=new Array(s),At=new Array(s),et=0,Ee=new Uint8Array(n.buffer);for(let R=0;R<s;R++){let rt=R<c?d:y;b[R]=Ee.slice(P,P+rt),At[R]=J.encode(b[R]),P+=rt,et=Math.max(et,rt)}let nt=new Uint8Array(r),Nt=0,E,C;for(E=0;E<et;E++)for(C=0;C<s;C++)E<b[C].length&&(nt[Nt++]=b[C][E]);for(E=0;E<p;E++)for(C=0;C<s;C++)nt[Nt++]=At[C][E];return nt}function dn(n,t,e,r){let o;if(Array.isArray(n))o=Ct.fromArray(n);else if(typeof n=="string"){let l=t;if(!l){let d=Ct.rawSplit(n);l=W.getBestVersionForData(d,e)}o=Ct.fromString(n,l||40)}else throw new Error("Invalid data");let i=W.getBestVersionForData(o,e);if(!i)throw new Error("The amount of data is too big to be stored in a QR Code");if(!t)t=i;else if(t<i)throw new Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: `+i+`.
`);let s=fn(t,e,o),u=tt.getSymbolSize(t),c=new We(u);return sn(c,t),un(c),cn(c,t),mt(c,e,0),t>=7&&an(c,t),ln(c,s),isNaN(r)&&(r=yt.getBestMask(c,mt.bind(null,c,e))),yt.applyMask(r,c),mt(c,e,r),{modules:c,version:t,errorCorrectionLevel:e,maskPattern:r,segments:o}}he.create=function(t,e){if(typeof t>"u"||t==="")throw new Error("No input text");let r=Et.M,o,i;return typeof e<"u"&&(r=Et.from(e.errorCorrectionLevel,Et.M),o=W.from(e.version),i=yt.from(e.maskPattern),e.toSJISFunc&&tt.setToSJISFunction(e.toSJISFunc)),dn(t,o,r,i)}});var hn={};Ne(hn,{create:()=>we.create});var we=Te(pe());return Ie(hn);})();

// Encode locally: QuickJS has neither Canvas nor Node Buffer/zlib.
// PNG uses 1-bit grayscale and stored DEFLATE blocks; no network or native tools.
function qrImage(text) {
  if (typeof text !== 'string' || !text || text.length > 2048) throw new Error('无效的登录二维码');
  var encoded = encodeURIComponent(text);
  var utf8 = [];
  for (var i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      utf8.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else utf8.push(encoded.charCodeAt(i));
  }
  var matrix = BilibiliQr.create([{ data: new Uint8Array(utf8), mode: 'byte' }], { errorCorrectionLevel: 'M' }).modules;
  var scale = 4;
  var width = (matrix.size + 8) * scale;
  var stride = Math.ceil(width / 8) + 1;
  var pixels = new Uint8Array(width * stride);
  for (var y = 0; y < width; y++) {
    var my = Math.floor(y / scale) - 4;
    for (var x = 0; x < width; x++) {
      var mx = Math.floor(x / scale) - 4;
      var dark = mx >= 0 && my >= 0 && mx < matrix.size && my < matrix.size && matrix.data[my * matrix.size + mx];
      if (!dark) pixels[y * stride + 1 + (x >> 3)] |= 128 >> (x & 7);
    }
  }
  var deflated = [0x78, 0x01];
  for (var offset = 0; offset < pixels.length;) {
    var length = Math.min(65535, pixels.length - offset);
    deflated.push(offset + length === pixels.length ? 1 : 0, length & 255, length >> 8, (~length) & 255, ((~length) >> 8) & 255);
    for (var j = 0; j < length; j++) deflated.push(pixels[offset + j]);
    offset += length;
  }
  var a = 1, b = 0;
  for (var p = 0; p < pixels.length; p++) { a = (a + pixels[p]) % 65521; b = (b + a) % 65521; }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  deflated.push.apply(deflated, u32(((b << 16) | a) >>> 0));
  var png = [137, 80, 78, 71, 13, 10, 26, 10];
  function chunk(type, data) {
    var bytes = [];
    for (var t = 0; t < type.length; t++) bytes.push(type.charCodeAt(t));
    for (var d = 0; d < data.length; d++) bytes.push(data[d]);
    var crc = 0xffffffff;
    for (var c = 0; c < bytes.length; c++) {
      crc ^= bytes[c];
      for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    png.push.apply(png, u32(data.length));
    for (var k = 0; k < bytes.length; k++) png.push(bytes[k]);
    png.push.apply(png, u32((crc ^ 0xffffffff) >>> 0));
  }
  chunk('IHDR', u32(width).concat(u32(width), [1, 0, 0, 0, 0]));
  chunk('IDAT', deflated);
  chunk('IEND', []);
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var base64 = '';
  for (var n = 0; n < png.length; n += 3) {
    var value = (png[n] << 16) | ((png[n + 1] || 0) << 8) | (png[n + 2] || 0);
    base64 += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63] +
      (n + 1 < png.length ? alphabet[(value >>> 6) & 63] : '=') +
      (n + 2 < png.length ? alphabet[value & 63] : '=');
  }
  return 'data:image/png;base64,' + base64;
}

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

// QR login view. authenticate owns the persisted session; this module only drives it.
var authViewText = {
  zh: {
    successTitle: '扫码登录成功', success: '已登录 Bilibili，后续下载将自动复用登录状态。', again: '重新扫码登录',
    guide: '使用哔哩哔哩 App 扫码登录', refresh: '刷新二维码', alt: 'Bilibili 登录二维码',
    waiting: '等待扫码…', scan: BILI_QR_MESSAGES.scan, confirm: BILI_QR_MESSAGES.confirm,
    expired: BILI_QR_MESSAGES.expired, expiredView: '二维码已失效，请刷新重试。',
    generate: '无法生成二维码，请点击刷新重试。', qrFail: '二维码生成失败，请刷新重试。',
    checkFail: '登录检查失败，请刷新二维码重试。', statusFail: '无法检查登录状态，请重试。',
    concurrent: '已有登录二维码正在使用，请关闭另一个登录窗口后重试。',
    cleanup: '无法清理登录会话，请重试。'
  },
  en: {
    successTitle: 'QR login successful', success: 'You are signed in to Bilibili. Downloads will reuse this login.', again: 'Scan a new QR code',
    guide: 'Scan with the Bilibili app to sign in', refresh: 'Refresh QR code', alt: 'Bilibili login QR code',
    waiting: 'Waiting for QR scan…', scan: 'Waiting for scan confirmation.', confirm: 'Scanned. Confirm the login in the Bilibili app.',
    expired: 'The QR code expired. Start QR login again.', expiredView: 'The QR code expired. Refresh to try again.',
    generate: 'Could not generate a QR code. Refresh to try again.', qrFail: 'Could not render the QR code. Refresh to try again.',
    checkFail: 'Could not check login. Refresh the QR code to try again.', statusFail: 'Could not check login status. Please try again.',
    concurrent: 'A login QR code is already in use. Close the other login window and try again.',
    cleanup: 'Could not clean up the login session. Please try again.'
  }
};

function authViewStatus(message, fallback) {
  if (!message) return { key: fallback };
  var key = Object.keys(BILI_QR_MESSAGES).find(function (key) { return BILI_QR_MESSAGES[key] === message; });
  return key ? { key: key } : { text: message };
}

var authViewOwner = null;
var authViewSequence = 0;

function authViewComplete(state) {
  state.sessionId = '';
  state.qr = '';
  state.authenticated = true;
  state.busy = false;
  if (state.timer) flux.timers.clear(state.timer);
  state.timer = 0;
  if (authViewOwner === state.owner) authViewOwner = null;
  state.ctx.refresh();
}

async function authViewCancel(state, sessionId) {
  var id = sessionId || state.sessionId;
  if (!id) return true;
  try {
    await globalThis.authenticate({ action: 'cancel', sessionId: id });
    if (state.sessionId === id) state.sessionId = '';
    return true;
  } catch (error) {
    state.error = { key: 'cleanup' };
    return false;
  }

}
async function authViewStop(state) {
  state.closed = true;
  if (state.timer) {
    flux.timers.clear(state.timer);
    state.timer = 0;
  }
  if (authViewOwner === state.owner) {
    if (state.busy) return false;
    if (!(await authViewCancel(state))) return false;
    if (authViewOwner === state.owner) authViewOwner = null;
  }
  return true;
}
async function authViewBegin(state) {
  if (state.closed || state.busy || authViewOwner !== state.owner) return;
  state.busy = true;
  state.qr = '';
  state.error = '';
  state.authenticated = false;
  var result;
  try {
    result = await globalThis.authenticate({ action: 'begin', input: '{"mode":"qr"}' });
  } catch (error) {
    if (!state.closed && authViewOwner === state.owner) state.error = { key: 'generate' };
    if (state.closed && authViewOwner === state.owner) authViewOwner = null;
    state.busy = false;
    if (!state.closed) state.ctx.refresh();
    return;
  }
  if (state.closed || authViewOwner !== state.owner) {
    state.sessionId = result && result.sessionId ? result.sessionId : '';
    if (state.sessionId) await authViewCancel(state);
    if (authViewOwner === state.owner && !state.sessionId) authViewOwner = null;
    state.busy = false;
    return;
  }
  state.busy = false;
  if (result.status === 'success') {
    authViewComplete(state);
    return;
  }
  if (result.status !== 'pending' || result.challengeType !== 'qrcode' || !result.challenge) {
    state.error = authViewStatus(result.message, 'generate');
    state.sessionId = result.sessionId || '';
    if (state.sessionId) await authViewCancel(state);
    state.ctx.refresh();
    return;
  }
  state.sessionId = result.sessionId;
  state.message = { key: 'waiting' };
  try {
    state.qr = qrImage(result.challenge);
  } catch (error) {
    state.error = { key: 'qrFail' };
    await authViewCancel(state);
    state.ctx.refresh();
    return;
  }
  state.ctx.refresh();
}

async function authViewPoll(state) {
  if (state.closed || state.busy || state.error || !state.sessionId || authViewOwner !== state.owner) return;
  state.busy = true;
  var result;
  try {
    result = await globalThis.authenticate({ action: 'poll', sessionId: state.sessionId });
  } catch (error) {
    if (state.closed && authViewOwner === state.owner) {
      if (await authViewCancel(state) && authViewOwner === state.owner) authViewOwner = null;
    } else if (authViewOwner === state.owner) {
      state.error = { key: 'checkFail' };
    }
    state.busy = false;
    if (!state.closed) state.ctx.refresh();
    return;
  }
  if (state.closed || authViewOwner !== state.owner) {
    if (state.closed && authViewOwner === state.owner) {
      if (await authViewCancel(state) && authViewOwner === state.owner) authViewOwner = null;
    }
    state.busy = false;
    return;
  }
  state.busy = false;
  if (result.status === 'success') {
    authViewComplete(state);
    return;
  }
  if (result.status === 'error') {
    if (await authViewCancel(state)) state.error = authViewStatus(result.message, 'expiredView');
  } else if (result.status === 'pending' && result.message) {
    state.message = authViewStatus(result.message, 'waiting');
  }
  state.ctx.refresh();
}

flux.ui.view('login', {
  async init(ctx) {
    var owner = ++authViewSequence;
    var state = { ctx: ctx, owner: owner, timer: 0, sessionId: '', qr: '', message: { key: 'waiting' }, error: '', busy: false, closed: false, authenticated: false };
    if (authViewOwner !== null) {
      state.error = { key: 'concurrent' };
      return state;
    }
    authViewOwner = owner;
    try {
      var saved = await globalThis.authenticate({ action: 'status' });
      if (saved.status === 'success') {
        authViewComplete(state);
        return state;
      }
    } catch (error) {
      state.error = { key: 'statusFail' };
      return state;
    }
    await authViewBegin(state);
    if (!state.closed && authViewOwner === owner && !state.timer) {
      state.timer = flux.timers.setInterval(function () { return authViewPoll(state); }, 2000);
    }
    return state;
  },
  render(state, ctx) {
    function t(key) { return biliText(ctx && ctx.locale, authViewText, key); }
    function status(message) { return message.key ? t(message.key) : message.text; }
    var h = flux.ui.h;
    if (state.authenticated) {
      return h('stack', { gap: 'md', padding: 'md', align: 'center' },
        h('heading', { text: t('successTitle'), level: 2 }),
        h('text', { text: t('success'), tone: 'success' }),
        h('button', { text: t('again'), variant: 'outline' }));
    }
    var guide = h('text', { text: t('guide'), weight: 'medium' });
    if (state.error) {
      return h('stack', { gap: 'sm', padding: 'md', align: 'center' },
        guide,
        h('text', { text: status(state.error) }),
        h('button', { text: t('refresh'), variant: 'primary' }));
    }
    return h('stack', { gap: 'sm', padding: 'md', align: 'center', justify: 'center' },
      guide,
      state.qr ? h('image', { src: state.qr, alt: t('alt'), width: 240, height: 240 }) : null,
      h('text', { text: status(state.message), tone: 'muted', size: 'sm' }));
  },
  async event(state, ev, ctx) {
    if (ev.type !== 'press' || state.closed) return;
    if (!(await authViewStop(state))) {
      state.closed = false;
      state.ctx.refresh();
      return;
    }
    state.closed = false;
    state.error = '';
    state.owner = ++authViewSequence;
    if (authViewOwner !== null) {
      state.error = { key: 'concurrent' };
      return;
    }
    authViewOwner = state.owner;
    await authViewBegin(state);
    if (!state.closed && authViewOwner === state.owner) {
      state.timer = flux.timers.setInterval(function () { return authViewPoll(state); }, 2000);
    }
  },
  async dispose(state) {
    await authViewStop(state);
  },
});

;(function () {
// FluxDown 独立 Bilibili 番剧插件。
//
// 两段式 resolver：
//   1. 番剧 season/media 链接 → 调 B 站番剧接口，返回正片/番外分集 manifest；
//   2. manifest 条目启动时 → 用 resolverItem(ep:<id>) 调 B 站播放接口取得 DASH
//      视频/音频短期直链，再交回 FluxDown 下载引擎。
//
// 追番与 UP 主更新由 FluxDown 的 subscribe 契约调度；插件只负责返回有限批次，
// 不创建后台定时器或直接建下载任务。

var API_BASE = 'https://api.bilibili.com';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
var MAX_EPISODES = 1000;
var MAX_VARIANTS = 16;
var BFE_ID_KEY = 'auth.bfe_id';
var MAX_MANIFEST_PATH_CHARS = 180;
// bili32 使用通用播放器接口时携带的 session 参数；番剧分集也能通过
// bvid + cid 走同一接口，并返回完整的 DASH 画质列表。
var PLAYER_SESSION = '68191c1dc3c75042c6f35fba895d65b0';

// DASH 返回的 height 通常存在，但部分接口/账号组合只返回画质码 id。
// 这些是 Bilibili Web 播放接口常见的画质码，作为 height 缺失时的回退。
var QUALITY_HEIGHT_BY_ID = {
  127: 4320, // 8K
  126: 1080, // 杜比视界
  125: 1080, // HDR
  120: 2160, // 4K
  116: 1080, // 1080P 60帧
  112: 1080, // 1080P+
  80: 1080,
  74: 720,
  64: 720,
  32: 480,
  16: 360,
};

function setting(name, fallback) {
  var value = flux.settings[name];
  return value == null ? fallback : value;
}
function pluginLog(level) {
  try {
    var logger = flux && flux.logger;
    if (!logger || typeof logger[level] !== 'function') return;
    var args = Array.prototype.slice.call(arguments, 1);
    logger[level].apply(logger, args);
  } catch (e) {}
}

function playQualityDiagnostics(play) {
  var value = play || {};
  var dash = value.dash && typeof value.dash === 'object' ? value.dash : {};
  var videos = Array.isArray(dash.video) ? dash.video : [];
  var formats = Array.isArray(value.support_formats) ? value.support_formats : [];
  var quality = Array.isArray(value.accept_quality) ? value.accept_quality.map(function(item) { return Number(item) || item; }) : [];
  var heights = videos.map(function(video) {
    return { id: Number(video && (video.id || video.quality)) || 0, height: Number(video && (video.height || video.height_cm)) || 0, width: Number(video && video.width) || 0, codec: String(video && (video.codecs || video.codecs_name) || '') };
  }).filter(function(item) { return item.id || item.height; });
  heights.sort(function(a, b) { return b.height - a.height || b.id - a.id; });
  return {
    acceptQuality: quality,
    supportFormats: formats.map(function(item) { return { quality: Number(item && (item.quality || item.quality_id)) || 0, format: String(item && (item.format || item.new_description || item.display_desc) || '') }; }),
    dashVideo: heights.slice(0, 16),
    dashMaxHeight: heights.reduce(function(max, item) { return Math.max(max, item.height); }, 0),
    durlQuality: Number(value.quality) || 0
  };
}

function logAuthDiagnostics(source, cookie, payload) {
  var data = payload && payload.data ? payload.data : {};
  pluginLog('info', '[bilibili] auth diagnostics', { source: source, hasSessdata: cookieContains(cookie, 'SESSDATA'), isLogin: data.isLogin === true, hasWbiImage: Boolean(data.wbi_img && data.wbi_img.img_url && data.wbi_img.sub_url) });
}

function truncateCodePoints(value, maxLength) {
  return Array.from(String(value || '')).slice(0, Math.max(0, maxLength)).join('');
}

function sanitizeFileName(name) {
  return truncateCodePoints((name || 'video')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim(), 120).replace(/[.\s]+$/, '') || 'video';
}

function sanitizePath(name) {
  var value = sanitizeFileName(name).replace(/[.]/g, ' ');
  return truncateCodePoints(value, 80).trim();
}


function fitManifestItems(items) {
  var usedNames = Object.create(null);
  return items.map(function(item) {
    var path = String(item.path || '');
    var pathLength = Array.from(path).length;
    var nameBudget = MAX_MANIFEST_PATH_CHARS - pathLength - (path ? 1 : 0);
    if (nameBudget < 1) throw new Error('番剧目录名超过 FluxDown 清单路径长度上限');
    var rawName = String(item.name || 'video');
    var dot = rawName.lastIndexOf('.');
    var extension = dot > 0 ? rawName.slice(dot) : '';
    if (Array.from(extension).length >= nameBudget) throw new Error('番剧文件扩展名超过 FluxDown 清单路径长度上限');
    var stem = extension ? rawName.slice(0, dot) : rawName;
    var pathKey = path.toLowerCase();
    if (!usedNames[pathKey]) usedNames[pathKey] = Object.create(null);
    var names = usedNames[pathKey];
    var candidate = '';
    for (var duplicate = 1; duplicate <= 10000; duplicate++) {
      var suffix = duplicate === 1 ? '' : ' (' + duplicate + ')';
      var stemBudget = nameBudget - Array.from(extension + suffix).length;
      if (stemBudget < 1) throw new Error('同目录中的番剧文件名无法唯一化');
      candidate = (truncateCodePoints(stem, stemBudget).replace(/[.\s]+$/, '') || 'v') + suffix + extension;
      if (!names[candidate.toLowerCase()]) break;
      candidate = '';
    }
    if (!candidate) throw new Error('同目录中的番剧文件名数量超过上限');
    names[candidate.toLowerCase()] = true;
    return Object.assign({}, item, { name: candidate });
  });
}


function cookieHeaderFromNetscape(raw) {
  var lines = String(raw || '').split(/\r?\n/);
  var pairs = [];
  var now = Math.floor(Date.now() / 1000);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // Netscape 导出会用 #HttpOnly_ 前缀标识 HttpOnly cookie；它不是注释。
    if (line.indexOf('#HttpOnly_') === 0) line = line.slice('#HttpOnly_'.length);
    else if (line[0] === '#') continue;
    var fields = line.split('\t');
    if (fields.length < 7 || !fields[5]) continue;
    var rawDomain = String(fields[0] || '').toLowerCase();
    var domain = rawDomain.replace(/^\./, '');
    var apiHost = 'api.bilibili.com';
    var includeSubdomains = String(fields[1]).toUpperCase() === 'TRUE';
    var belongsToBilibili = domain === 'bilibili.com' || domain.endsWith('.bilibili.com');
    var domainMatches = belongsToBilibili && (domain === apiHost || (includeSubdomains && apiHost.endsWith('.' + domain)));
    var cookiePath = String(fields[2] || '/');
    var secure = String(fields[3]).toUpperCase() === 'TRUE';
    var expires = Number(fields[4]) || 0;
    if (!domainMatches || cookiePath !== '/' || (secure && !API_BASE.startsWith('https://')) || (expires > 0 && expires <= now)) continue;
    pairs.push(fields[5] + '=' + fields.slice(6).join('\t'));
  }
  return pairs.join('; ');
}

function cookieHeader(raw) {
  var value = String(raw || '').trim();
  if (!value) return '';
  if (/^#\s*(Netscape|HTTP Cookie File)/i.test(value) || /\t/.test(value)) {
    return cookieHeaderFromNetscape(value);
  }
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function normalizeSessdataCookie(cookie) {
  return String(cookie || '').replace(/(^|;\s*)SESSDATA=([^;]*)/i, function(_, prefix, value) {
    return prefix + 'SESSDATA=' + String(value || '').replace(/,/g, '%2C').replace(/\*/g, '%2A');
  });
}

async function cookieFromAuthProfile() {
  if (!flux.auth || typeof flux.auth.get !== 'function') return '';
  var apiAuthRef = 'gulanthys@bilibili-bangumi::https://api.bilibili.com';
  try {
    var raw = await flux.storage.get('auth.refs');
    var parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      var hasApiRef = parsed.some(function(ref) {
        return String(ref || '').replace('::api.bilibili.com', '::https://api.bilibili.com') === apiAuthRef;
      });
      if (parsed.length && !hasApiRef) return '';
    }
  } catch (e) {}
  try {
    var profile = await flux.auth.get(apiAuthRef);
    var expiresAt = Number(profile && profile.expiresAt) || 0;
    if (profile && (!expiresAt || expiresAt > Math.floor(Date.now() / 1000))) {
      var profileCookie = cookieHeader(profile.cookies || '');
      if (/(?:^|;\s*)SESSDATA=/i.test(profileCookie)) return profileCookie;
    }
  } catch (e) {}
  return '';
}

async function effectiveCookie(ctx) {
  var raw = String((ctx && ctx.cookies) || '').trim();
  if (!raw) raw = String(setting('cookies', '') || '').trim();
  var cookie = normalizeSessdataCookie(cookieHeader(raw));
  if (cookie) return await appendStoredBfeId(cookie);
  var profileCookie = await cookieFromAuthProfile();
  return profileCookie ? await appendStoredBfeId(profileCookie) : '';
}

function cookieContains(cookie, name) {
  return new RegExp('(?:^|;\\s*)' + String(name).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '=', 'i').test(String(cookie || ''));
}

async function appendStoredBfeId(cookie) {
  var value = String(cookie || '').trim();
  if (!value || cookieContains(value, 'bfe_id')) return value;
  try {
    var bfeId = await flux.storage.get(BFE_ID_KEY);
    if (bfeId) return value + '; bfe_id=' + String(bfeId).trim();
  } catch (e) {}
  return value;
}


function responseHeader(response, name) {
  var headers = response && response.headers ? response.headers : {};
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === String(name).toLowerCase()) return String(headers[keys[i]] || '');
  }
  return '';
}

async function rememberResponseBfeId(response) {
  var setCookie = responseHeader(response, 'set-cookie');
  var match = /(?:^|[;\\n,]\\s*)bfe_id=([^;\\n,]+)/i.exec(setCookie);
  if (!match || !match[1]) return;
  try { await flux.storage.set(BFE_ID_KEY, match[1].trim()); } catch (e) {}
}

function hasHeader(headers, name) {
  var target = String(name || '').toLowerCase();
  var keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === target) return true;
  }
  return false;
}

function requestHeaders(cookie, ctx) {
  var headers = {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://www.bilibili.com/',
    'User-Agent': USER_AGENT,
  };
  var taskHeaders = ctx && ctx.extraHeaders;
  if (taskHeaders && typeof taskHeaders === 'object') {
    var keys = Object.keys(taskHeaders);
    for (var i = 0; i < keys.length; i++) {
      if (taskHeaders[keys[i]] != null) headers[keys[i]] = String(taskHeaders[keys[i]]);
    }
  }
  if (ctx && ctx.referrer) headers.Referer = String(ctx.referrer);
  if (ctx && ctx.userAgent) headers['User-Agent'] = String(ctx.userAgent);
  if (cookie) headers.Cookie = cookie;
  return headers;
}



async function apiGet(path, ctx, cookie) {
  var response;
  try {
    var requestCookie = cookie || await effectiveCookie(ctx);
    response = await flux.fetch({
      method: 'GET',
      url: API_BASE + path,
      headers: requestHeaders(requestCookie, ctx),
    });
  } catch (e) {
    throw new Error('Bilibili 接口请求失败: ' + String(e));
  }

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error('Bilibili 接口 HTTP 状态异常: ' + String(response && response.status));
  }

  var payload;
  try {
    payload = JSON.parse(response.body || '');
  } catch (e) {
    throw new Error('Bilibili 接口返回非法 JSON: ' + String(e));
  }
  if (!payload || Number(payload.code) !== 0) {
    throw new Error(
      'Bilibili 接口错误 code=' + String(payload && payload.code) +
      ': ' + String((payload && payload.message) || 'unknown')
    );
  }
  await rememberResponseBfeId(response);
  // PGC 接口返回 result，通用播放器接口返回 data。
  var result = payload.result || payload.data || {};
  if (/\/playurl(?:\?|$)/.test(path)) {
    pluginLog('info', '[bilibili] playurl diagnostics', {
      hasSessdata: cookieContains(requestCookie, 'SESSDATA'),
      diagnostics: playQualityDiagnostics(result),
    });
  }
  return result;
}

function md5(input) {
  function safeAdd(x, y) {
    var lsw = (x & 65535) + (y & 65535);
    return (((x >>> 16) + (y >>> 16) + (lsw >>> 16)) << 16) | (lsw & 65535);
  }
  function bitRol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function words(value) {
    var bytes = unescape(encodeURIComponent(String(value)));
    var n = bytes.length, count = ((n + 8) >>> 6) + 1, result = new Array(count * 16);
    for (var i = 0; i < result.length; i++) result[i] = 0;
    for (var j = 0; j < n; j++) result[j >> 2] |= bytes.charCodeAt(j) << ((j % 4) * 8);
    result[n >> 2] |= 0x80 << ((n % 4) * 8);
    result[count * 16 - 2] = n * 8;
    return result;
  }
  function hex(value) {
    var table = '0123456789abcdef', out = '';
    for (var i = 0; i < 4; i++) out += table.charAt((value >>> (i * 8 + 4)) & 15) + table.charAt((value >>> (i * 8)) & 15);
    return out;
  }
  var x = words(input), a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (var i = 0; i < x.length; i += 16) {
    var oa = a, ob = b, oc = c, od = d;
    a = ff(a,b,c,d,x[i+0],7,0xd76aa478); d = ff(d,a,b,c,x[i+1],12,0xe8c7b756); c = ff(c,d,a,b,x[i+2],17,0x242070db); b = ff(b,c,d,a,x[i+3],22,0xc1bdceee);
    a = ff(a,b,c,d,x[i+4],7,0xf57c0faf); d = ff(d,a,b,c,x[i+5],12,0x4787c62a); c = ff(c,d,a,b,x[i+6],17,0xa8304613); b = ff(b,c,d,a,x[i+7],22,0xfd469501);
    a = ff(a,b,c,d,x[i+8],7,0x698098d8); d = ff(d,a,b,c,x[i+9],12,0x8b44f7af); c = ff(c,d,a,b,x[i+10],17,0xffff5bb1); b = ff(b,c,d,a,x[i+11],22,0x895cd7be);
    a = ff(a,b,c,d,x[i+12],7,0x6b901122); d = ff(d,a,b,c,x[i+13],12,0xfd987193); c = ff(c,d,a,b,x[i+14],17,0xa679438e); b = ff(b,c,d,a,x[i+15],22,0x49b40821);
    a = gg(a,b,c,d,x[i+1],5,0xf61e2562); d = gg(d,a,b,c,x[i+6],9,0xc040b340); c = gg(c,d,a,b,x[i+11],14,0x265e5a51); b = gg(b,c,d,a,x[i+0],20,0xe9b6c7aa);
    a = gg(a,b,c,d,x[i+5],5,0xd62f105d); d = gg(d,a,b,c,x[i+10],9,0x02441453); c = gg(c,d,a,b,x[i+15],14,0xd8a1e681); b = gg(b,c,d,a,x[i+4],20,0xe7d3fbc8);
    a = gg(a,b,c,d,x[i+9],5,0x21e1cde6); d = gg(d,a,b,c,x[i+14],9,0xc33707d6); c = gg(c,d,a,b,x[i+3],14,0xf4d50d87); b = gg(b,c,d,a,x[i+8],20,0x455a14ed);
    a = gg(a,b,c,d,x[i+13],5,0xa9e3e905); d = gg(d,a,b,c,x[i+2],9,0xfcefa3f8); c = gg(c,d,a,b,x[i+7],14,0x676f02d9); b = gg(b,c,d,a,x[i+12],20,0x8d2a4c8a);
    a = hh(a,b,c,d,x[i+5],4,0xfffa3942); d = hh(d,a,b,c,x[i+8],11,0x8771f681); c = hh(c,d,a,b,x[i+11],16,0x6d9d6122); b = hh(b,c,d,a,x[i+14],23,0xfde5380c);
    a = hh(a,b,c,d,x[i+1],4,0xa4beea44); d = hh(d,a,b,c,x[i+4],11,0x4bdecfa9); c = hh(c,d,a,b,x[i+7],16,0xf6bb4b60); b = hh(b,c,d,a,x[i+10],23,0xbebfbc70);
    a = hh(a,b,c,d,x[i+13],4,0x289b7ec6); d = hh(d,a,b,c,x[i+0],11,0xeaa127fa); c = hh(c,d,a,b,x[i+3],16,0xd4ef3085); b = hh(b,c,d,a,x[i+6],23,0x04881d05);
    a = hh(a,b,c,d,x[i+9],4,0xd9d4d039); d = hh(d,a,b,c,x[i+12],11,0xe6db99e5); c = hh(c,d,a,b,x[i+15],16,0x1fa27cf8); b = hh(b,c,d,a,x[i+2],23,0xc4ac5665);
    a = ii(a,b,c,d,x[i+0],6,0xf4292244); d = ii(d,a,b,c,x[i+7],10,0x432aff97); c = ii(c,d,a,b,x[i+14],15,0xab9423a7); b = ii(b,c,d,a,x[i+5],21,0xfc93a039);
    a = ii(a,b,c,d,x[i+12],6,0x655b59c3); d = ii(d,a,b,c,x[i+3],10,0x8f0ccc92); c = ii(c,d,a,b,x[i+10],15,0xffeff47d); b = ii(b,c,d,a,x[i+1],21,0x85845dd1);
    a = ii(a,b,c,d,x[i+8],6,0x6fa87e4f); d = ii(d,a,b,c,x[i+15],10,0xfe2ce6e0); c = ii(c,d,a,b,x[i+6],15,0xa3014314); b = ii(b,c,d,a,x[i+13],21,0x4e0811a1);
    a = ii(a,b,c,d,x[i+4],6,0xf7537e82); d = ii(d,a,b,c,x[i+11],10,0xbd3af235); c = ii(c,d,a,b,x[i+2],15,0x2ad7d2bb); b = ii(b,c,d,a,x[i+9],21,0xeb86d391);
    a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
  }
  return hex(a) + hex(b) + hex(c) + hex(d);
}
var WBI_CACHE_KEY = 'bilibili.wbi.keys';
var WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30,
  4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11
];

function wbiKeyPart(url) {
  var value = String(url || '').split('?')[0];
  var slash = value.lastIndexOf('/');
  var name = slash >= 0 ? value.slice(slash + 1) : value;
  var dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function wbiMixinKey(imgKey, subKey) {
  var raw = String(imgKey || '') + String(subKey || ''), out = '';
  for (var i = 0; i < WBI_MIXIN_KEY_ENC_TAB.length; i++) {
    if (raw[WBI_MIXIN_KEY_ENC_TAB[i]]) out += raw[WBI_MIXIN_KEY_ENC_TAB[i]];
  }
  return out.slice(0, 32);
}

async function apiGetPayload(path, ctx, cookie) {
  var response;
  try {
    var requestCookie = cookie || await effectiveCookie(ctx);
    response = await flux.fetch({
      method: 'GET',
      url: API_BASE + path,
      headers: requestHeaders(requestCookie, ctx),
    });
  } catch (e) {
    throw new Error('Bilibili 接口请求失败: ' + String(e));
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error('Bilibili 接口 HTTP 状态异常: ' + String(response && response.status));
  }
  var payload;
  try { payload = JSON.parse(response.body || ''); } catch (e) {
    throw new Error('Bilibili 接口返回非法 JSON: ' + String(e));
  }
  await rememberResponseBfeId(response);
  if (/\/x\/web-interface\/nav(?:\?|$)/.test(path)) logAuthDiagnostics('nav', requestCookie, payload);
  return payload;
}

async function getWbiKeys(ctx, cookie, forceRefresh) {
  if (!forceRefresh) {
    try {
      var cached = JSON.parse(String(await flux.storage.get(WBI_CACHE_KEY) || 'null'));
      if (cached && cached.mixinKey && Number(cached.expiresAt) > Date.now()) return cached.mixinKey;
    } catch (e) {}
  }
  var payload = await apiGetPayload('/x/web-interface/nav', ctx, cookie);
  var image = payload && payload.data && payload.data.wbi_img;
  var mixinKey = wbiMixinKey(wbiKeyPart(image && image.img_url), wbiKeyPart(image && image.sub_url));
  if (!mixinKey) throw new Error('Bilibili WBI key 获取失败');
  try {
    await flux.storage.set(WBI_CACHE_KEY, JSON.stringify({ mixinKey: mixinKey, expiresAt: Date.now() + 12 * 60 * 60 * 1000 }));
  } catch (e) {}
  return mixinKey;
}

function wbiEncode(value) {
  return encodeURIComponent(String(value == null ? '' : value)).replace(/[!'()*]/g, '');
}

async function signedWbiPath(path, params, ctx, cookie, forceRefresh) {
  var mixinKey = await getWbiKeys(ctx, cookie, forceRefresh);
  var all = {};
  var keys = Object.keys(params || {});
  for (var i = 0; i < keys.length; i++) all[keys[i]] = params[keys[i]];
  all.wts = Math.floor(Date.now() / 1000);
  keys = Object.keys(all).sort();
  var query = [];
  for (var j = 0; j < keys.length; j++) query.push(wbiEncode(keys[j]) + '=' + wbiEncode(all[keys[j]]));
  var queryString = query.join('&');
  return path + '?' + queryString + '&w_rid=' + md5(queryString + mixinKey);
}

async function apiGetWbi(path, params, ctx, cookie) {
  var lastError = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return await apiGet(await signedWbiPath(path, params, ctx, cookie, attempt > 0), ctx, cookie);
    } catch (e) {
      lastError = e;
      if (attempt === 0 && /code=(-352|-799)/.test(String(e))) {
        try { await flux.storage.set(WBI_CACHE_KEY, ''); } catch (ignored) {}
        // Resolver scripts have no global timer; retry the refreshed signature immediately.
        continue;
      }
      break;
    }
  }
  throw lastError || new Error('Bilibili WBI 接口请求失败');
}
function htmlAttribute(tag, name) {
  var match = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return match ? String(match[1] == null ? match[2] : match[1]).replace(/&amp;/gi, '&') : '';
}

async function expandBilibiliShortUrl(ctx) {
  var url = String(ctx.url || '').trim();
  if (!/^https?:\/\/(?:b23\.tv|bili2233\.cn)\/[a-z0-9]+\/?(?:[?#]|$)/i.test(url)) return ctx;
  // 宿主自动跟随重定向但不暴露最终 URL；从落地页读取规范链接。
  // 不转发任务 Cookie、自定义头或认证引用到短链服务。
  var response = await flux.fetch({
    method: 'GET',
    url: url,
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/' },
  });
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error('Bilibili 短链展开失败，HTTP 状态: ' + String(response && response.status));
  }
  if (response.truncated) throw new Error('Bilibili 短链页面被截断，无法可靠识别目标');
  var html = String(response.body || '');
  var tags = html.match(/<(?:link|meta)\b[^>]*>/gi) || [];
  var target = '';
  for (var i = 0; i < tags.length; i++) {
    if (htmlAttribute(tags[i], 'rel').toLowerCase() === 'canonical') {
      target = htmlAttribute(tags[i], 'href');
      break;
    }
    if (htmlAttribute(tags[i], 'property').toLowerCase() === 'og:url') target = htmlAttribute(tags[i], 'content');
  }
  if (!/^https?:\/\/(?:(?:www|m)\.)?bilibili\.com\/(?:video\/(?:BV[0-9a-z]+|av\d+)\/?(?:[?#]|$)|bangumi\/(?:play|media)(?:\/|\?))/i.test(target) &&
      !/^https?:\/\/space\.bilibili\.com\/\d+\/?(?:[?#]|$)/i.test(target)) {
    throw new Error('Bilibili 短链未返回支持的页面，可能触发验证码或链接目标不受支持');
  }
  if (/\/video\//i.test(target) && /__INITIAL_STATE__\s*=/.test(html)) {
    var stateMatch = /__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:\(function|<\/script>)/.exec(html);
    if (!stateMatch) throw new Error('Bilibili 短链页面状态无法识别，无法保留分 P');
    var state = JSON.parse(stateMatch[1]);
    if (state.p != null) {
      var page = Number(state.p);
      if (!Number.isInteger(page) || page < 1) throw new Error('Bilibili 短链页面分 P 非法');
      target = target.split('#')[0].replace(/([?&])p=[^&]*/i, '$1p=' + page);
      if (!/[?&]p=/.test(target)) target += (target.indexOf('?') < 0 ? '?' : '&') + 'p=' + page;
    }
  }
  return Object.assign({}, ctx, { url: target });
}

function firstMatch(url, pattern) {
  var match = pattern.exec(url || '');
  return match && match[1] ? match[1] : '';
}

async function seasonIdFromUrl(url, ctx, cookie) {
  var seasonId = firstMatch(url, /\/bangumi\/play\/ss(\d+)/i);
  if (seasonId) return seasonId;

  var mediaId = firstMatch(url, /\/bangumi\/media\/md(\d+)/i);
  if (mediaId) {
    var media = await apiGet('/pgc/review/user?media_id=' + encodeURIComponent(mediaId), ctx, cookie);
    var mediaInfo = media.media || {};
    if (mediaInfo.season_id) return String(mediaInfo.season_id);
  }

  var episodeId = firstMatch(url, /\/bangumi\/play\/ep(\d+)/i);
  if (episodeId) {
    var episodeResult = await apiGet(
      '/pgc/view/web/season?ep_id=' + encodeURIComponent(episodeId),
      ctx,
      cookie
    );
    if (episodeResult.season_id) return String(episodeResult.season_id);
  }

  var query = /[?&]season_id=(\d+)/i.exec(url || '');
  return query && query[1] ? query[1] : '';
}

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
})();

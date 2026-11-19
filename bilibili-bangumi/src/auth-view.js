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

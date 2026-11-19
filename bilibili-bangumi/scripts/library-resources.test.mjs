import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

function uiNode(type, props, ...children) { return { type, props, children: children.flat().filter(Boolean) }; }
function uiProps(node, key) {
  if (node.props.key === key) return node.props;
  for (const child of node.children) {
    const found = uiProps(child, key);
    if (found) return found;
  }
}

test('the portable input enqueues bare IDs and a shared selected part, never a foreign link', async () => {
  const views = new Map(), created = [];
  const ctx = { refresh() {} };
  const flux = { settings: {}, storage: { get: async () => null },
    ui: { h: uiNode, view: (id, def) => views.set(id, def) },
    tasks: { create: async params => created.push(params.request) },
  };
  vm.runInNewContext(main, { flux });
  const view = views.get('library');
  const state = await view.init(ctx);
  const submit = async value => {
    await view.event(state, { node: 'root/0/submit/input', type: 'change', value }, ctx);
    await view.event(state, { node: 'root/0/submit/submit-input', type: 'press' }, ctx);
  };
  await submit('分享文案（https://m.bilibili.com/video/BV1nfj86AEAo/?p=2&from=share）');
  await submit('000123');
  await submit('EP28770');
  await submit('https://not-bilibili.example/video/BV1nfj86AEAo');
  assert.deepEqual(created.map(req => [req.url, req.startPaused]), [
    ['https://www.bilibili.com/video/BV1nfj86AEAo?p=2', true],
    ['https://www.bilibili.com/video/av123', true],
    ['https://www.bilibili.com/bangumi/play/ep28770', true],
  ]);
  const en = view.render(state, { locale: 'en-GB' });
  const zh = view.render(state, { locale: 'zh-CN' });
  const unsupported = view.render(state, { locale: 'fr-FR' });
  assert.match(uiProps(en, 'input-status').text, /Unrecognized Bilibili content/);
  assert.match(uiProps(zh, 'input-status').text, /无法识别 Bilibili 内容/);
  assert.equal(uiProps(unsupported, 'input-status').text, uiProps(en, 'input-status').text);
  assert.equal(uiProps(zh, 'input').value, 'https://not-bilibili.example/video/BV1nfj86AEAo');
  assert.equal(uiProps(zh, 'submit-input').text, '加入待下载');
});

test('history paging keeps two parts of one BV distinct and retries only failed batch items', async () => {
  const library = {};
  const seen = [];
  let failure = true;
  const ctx = { refresh() {} };
  const flux = { settings: { cookies: 'SESSDATA=test' },
    storage: { get: async () => null, set: async () => {} },
    ui: { h: uiNode, view: (id, def) => { library[id] = def; } },
    fetch: async ({ url }) => {
      const json = data => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
      if (url.includes('/nav')) return json({ isLogin: true, mid: 42, uname: 'Tester' });
      const second = url.includes('max=7');
      return json({ cursor: { max: second ? 0 : 7, view_at: second ? 0 : 99 }, list: [
        { title: 'History entry', history: { business: 'archive', bvid: 'BV1nfj86AEAo', page: second ? 2 : 1 } },
      ] });
    },
    tasks: { create: async ({ request }) => {
      seen.push(request.url);
      assert.equal(request.startPaused, true);
      if (request.url.endsWith('?p=2') && failure) throw new Error('queue busy');
    } },
  };
  vm.runInNewContext(main, { flux });
  const view = library.library;
  const state = await view.init(ctx);
  const press = name => view.event(state, { node: 'root/' + name, type: 'press' }, ctx);
  const first = 'https://www.bilibili.com/video/BV1nfj86AEAo?p=1';
  const second = first.replace('p=1', 'p=2');
  await press('toggle-' + encodeURIComponent(first));
  await press('next');
  assert.equal(state.hasNext, false);
  await press('toggle-' + encodeURIComponent(second));
  await press('enqueue-button');
  const en = view.render(state, { locale: 'en' });
  const zh = view.render(state, { locale: 'zh-Hans' });
  assert.match(uiProps(en, 'error').text, /queue busy/);
  assert.match(uiProps(en, 'enqueue-result').text, /Tasks created: 1\. Failed: 1/);
  assert.match(uiProps(zh, 'enqueue-result').text, /已创建 1 个任务。失败 1 个/);
  assert.equal(uiProps(zh, 'media-title').text, 'History entry');
  failure = false;
  await press('enqueue-button');
  assert.deepEqual(seen, [first, second, second]);
});

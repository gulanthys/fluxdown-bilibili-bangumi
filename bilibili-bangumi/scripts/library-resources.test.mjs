import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const resolver = readFileSync(new URL('../resolve.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

function uiNode(type, props, ...children) { return { type, props, children: children.flat().filter(Boolean) }; }
function uiProps(node, key) {
  if (node.props.key === key) return node.props;
  for (const child of node.children) {
    const found = uiProps(child, key);
    if (found) return found;
  }
}

test('AI metadata fallback preserves an ordinary subtitle and re-resolves the AI track into SRT', async () => {
  const str = (field, value) => {
    const buffer = Buffer.from(value);
    assert.ok(buffer.length < 128);
    return Buffer.concat([Buffer.from([field * 8 + 2, buffer.length]), buffer]);
  };
  const aiUrl = 'https://aisubtitle.hdslb.com/subtitle/ai.json';
  const proto = str(1, str(3, Buffer.concat([str(3, 'ai-zh'), str(4, '中文'), str(5, aiUrl)]))).toString('base64');
  const calls = [];
  const json = body => ({ status: 200, body: JSON.stringify(body) });
  const c = vm.createContext({ atob, btoa, flux: {
    settings: { cookies: 'SESSDATA=test', subtitles: true, aiSubtitles: true },
    storage: { get: async () => null, set: async () => {} },
    fetch: async req => {
      calls.push(req);
      if (req.url.includes('/x/web-interface/view?')) return json({ code: 0, data: { bvid: 'BV1nfj86AEAo', aid: 72, title: '素材', pages: [{ cid: 15 }] } });
      if (req.url.includes('/x/web-interface/nav')) return json({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/a/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://i0.hdslb.com/a/abcdefghijklmnopqrstuvwxyz012345.png' } } });
      if (req.url.includes('/x/player/wbi/v2?')) return json({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//i0.hdslb.com/human.json' }] } } });
      if (req.url.includes('/x/v2/subtitle/web/view?')) {
        assert.match(req.url, /[?&]oid=15&pid=72&/);
        assert.equal(req.responseType, 'base64');
        return { status: 200, body: proto };
      }
      if (req.url === aiUrl) return json({ body: [{ from: 1.23, to: 2, content: '字幕测试' }] });
      throw new Error(req.url);
    },
  } });
  vm.runInContext(resolver, c);
  const url = 'https://www.bilibili.com/video/BV1nfj86AEAo';
  const { manifest } = await c.resolve({ url });
  const human = manifest.items.find(item => item.id.includes('resource:subtitles:'));
  const ai = manifest.items.find(item => item.id.includes('resource:aiSubtitles:'));
  assert.match(human.name, /zh-CN/);
  assert.match(ai.name, /AI .*ai-zh/);
  const resolved = await c.resolve({ url, resolverItem: ai.id });
  assert.equal(Buffer.from(resolved.contentBase64, 'base64').toString(), '1\n00:00:01,230 --> 00:00:02,000\n字幕测试\n');
  assert.equal(calls.find(req => req.url === aiUrl).headers.Cookie, undefined);
});

test('ASS keeps scrolling direction, fixed placement, time and ASS-safe text', () => {
  const c = vm.createContext({});
  vm.runInContext(resolver, c);
  const result = c.resourceDanmakuAss('<i><d p="1.23,6,25,255">红&#x5b57;{\\N}</d><d p="2,4,30,16777215">底部</d></i>');
  assert.match(result, /Dialogue: 0,00:00:01\.23,00:00:09\.23,[^\n]+\\move\(-\d+,18,1920,18\)[^\n]+红字\s+N/);
  assert.match(result, /\\an2\\pos\(960,1062\)[^\n]+底部/);
});

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

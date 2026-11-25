import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

function uiNode(type, props, ...children) {
  // QuickJS h() only elides null, undefined and booleans; scalar children fail host validation.
  const nodes = children.flat(Infinity).filter(child => child != null && typeof child !== 'boolean');
  assert.ok(nodes.every(child => typeof child === 'object' && child.type), 'portable children must be nodes');
  return { type, props, children: nodes };
}
function uiProps(node, key) {
  if (node.props.key === key) return node.props;
  for (const child of node.children) {
    const found = uiProps(child, key);
    if (found) return found;
  }
}

test('folder and collection pickers show the selected source without losing an earlier selection', async () => {
  const views = new Map(), images = [];
  const ctx = { locale: 'zh', refresh() {}, images: {
    load: async ({ url, circle, cornerRadius }) => {
      if (circle) throw new Error('unknown field `circle`');
      images.push(url);
      return 'flux-image:' + (cornerRadius === 12 ? 'rounded-' : '') + url.split('/').pop();
    },
    release: async () => {},
  } };
  const json = data => ({ status: 200, body: JSON.stringify({ code: 0, data }) });
  const flux = { settings: { cookies: 'SESSDATA=test' }, storage: { get: async () => null },
    ui: { h: uiNode, view: (id, def) => views.set(id, def) },
    fetch: async ({ url }) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith('/nav')) return json({ isLogin: true, mid: 42, uname: 'Tester', face: '//i0.hdslb.com/avatar.jpg' });
      if (pathname.endsWith('/cursor')) return json({ list: [] });
      if (pathname.endsWith('/list-all')) return json({ list: [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }] });
      if (pathname.endsWith('/resource/list')) {
        const id = searchParams.get('media_id');
        return json({ medias: [{ id, title: 'Folder ' + id, cover: 'http://i1.hdslb.com/cover.jpg', upper: { name: 'Author' } }] });
      }
      if (pathname.endsWith('/seasons_series_list')) {
        return json({ page: { total: 21 }, seasons_list: searchParams.get('page_num') === '2'
          ? [{ id: 3, name: 'Season' }, { id: 4, name: 'Other' }] : [{ id: 3, name: 'Season' }] });
      }
      if (pathname.endsWith('/seasons_archives_list')) return json({ archives: [{ aid: 4, title: 'Season ' + searchParams.get('season_id') }] });
      throw new Error('Unexpected URL: ' + url);
    },
  };
  vm.runInNewContext(main, { flux });
  const view = views.get('library'), state = await view.init(ctx);
  const event = (node, value) => view.event(state, { node, type: 'change', value }, ctx);
  const render = () => view.render(state, ctx);
  assert.equal(uiProps(render(), 'account-uid').text, 'UID 42');
  assert.equal(uiProps(render(), 'account-name').text, 'Tester');
  assert.equal(uiProps(render(), 'avatar').src, 'flux-image:avatar.jpg');
  assert.equal(uiProps(render(), 'batch'), undefined);
  await event('sources', 'favorites');
  await event('folders', '2');
  assert.equal(uiProps(render(), 'media-title').text, 'Folder 2');
  assert.equal(uiProps(render(), 'media-details').text, 'Author');
  assert.equal(uiProps(render(), 'cover').src, 'flux-image:rounded-cover.jpg');
  assert.ok(images.includes('https://i1.hdslb.com/cover.jpg'));
  await event('toggle-' + encodeURIComponent('https://www.bilibili.com/video/av2?p=1'), true);
  await event('sources', 'collections');
  await view.event(state, { node: 'collections-more', type: 'press' }, ctx);
  assert.equal(uiProps(render(), 'collections').value, 'season:3');
  assert.equal(uiProps(render(), 'collections').options.length, 2);
  await event('collections', 'season:4');
  assert.equal(uiProps(render(), 'media-title').text, 'Season 4');
  assert.equal(uiProps(render(), 'outside-count').text, '另有 1 项不在此列表');
  assert.equal(uiProps(render(), 'enqueue-button').text, '加入待下载（1）');
  await view.event(state, { node: 'review', type: 'press' }, ctx);
  assert.equal(uiProps(render(), 'media-title').text, 'Folder 2');
  await view.event(state, { node: 'remove-' + encodeURIComponent('https://www.bilibili.com/video/av2?p=1'), type: 'press' }, ctx);
  assert.equal(uiProps(render(), 'batch'), undefined);
  assert.equal(uiProps(render(), 'media-title').text, 'Season 4');
});

test('loading more appends history with playback details and preserves selection through a failed batch', async () => {
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
      const item = (page, progress) => ({
        title: 'History entry', author_name: 'Creator', duration: 378, progress,
        view_at: new Date(2025, 0, 2, 12).getTime() / 1000,
        history: { business: 'archive', bvid: 'BV1nfj86AEAo', page },
      });
      return json({ cursor: { max: second ? 0 : 7, view_at: second ? 0 : 99 }, list: second
        ? [item(1, 125), item(2, -1)] : [item(1, 125)] });
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
  const choose = url => view.event(state, { node: 'root/toggle-' + encodeURIComponent(url), type: 'change', value: true }, ctx);
  const render = () => view.render(state, { locale: 'en' });
  assert.equal(uiProps(render(), 'media-duration').text, '06:18');
  assert.equal(uiProps(render(), 'media-date').text, '2025-01-02');
  assert.equal(uiProps(render(), 'media-details').text, 'Creator · Watched 02:05');
  await choose(first);
  await press('more');
  const tree = render();
  assert.equal(uiProps(tree, 'more'), undefined);
  assert.equal(tree.children.find(node => node.type === 'scroll').children[0].children.length, 2);
  assert.equal(uiProps(tree, 'toggle-' + encodeURIComponent(first)).checked, true);
  await choose(second);
  assert.equal(uiProps(render(), 'enqueue-button').text, 'Add to queue (2)');
  await press('enqueue-button');
  const en = view.render(state, { locale: 'en' });
  const zh = view.render(state, { locale: 'zh-Hans' });
  assert.match(uiProps(en, 'enqueue-error').text, /queue busy/);
  assert.match(uiProps(en, 'enqueue-result').text, /Tasks created: 1\. Failed: 1/);
  assert.match(uiProps(zh, 'enqueue-result').text, /已创建 1 个任务。失败 1 个/);
  assert.equal(uiProps(zh, 'enqueue-button').text, '加入待下载（1）');
  failure = false;
  await press('enqueue-button');
  assert.deepEqual(seen, [first, second, second]);
});

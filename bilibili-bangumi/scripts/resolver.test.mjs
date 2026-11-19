import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = ['runtime', 'bangumi', 'dash', 'subscriptions', 'resources', 'entry'].map(name => readFileSync(new URL('../src/' + name + '.js', import.meta.url), 'utf8')).join('\n');
function runtime() {
  const context = vm.createContext({ flux: { settings: {}, storage: { get: async () => null } } });
  vm.runInContext(source, context);
  return context;
}

for (const kind of ['episode', 'uploader']) {
  test(kind + ' selected quality failure never retries a different quality', async () => {
    const c = runtime();
    const requests = [];
    c.apiGet = async path => {
      requests.push(path);
      if (path.includes('/season?')) return { episodes: [{ id: 1 }] };
      if (path.includes('qn=80')) throw new Error('selected quality unavailable');
      return { dash: { video: [{ id: 80, height: 1080, base_url: 'https://cdn.example/video' }] } };
    };
    await assert.rejects(kind === 'episode'
      ? c.resolveEpisode({ resolverItem: 'ep:1@q:80' })
      : c.resolveUploaderVideo({ resolverItem: 'video:BVtest:cid:1@q:80', title: 'video' }), /selected quality unavailable/);
    assert.equal(requests.filter(path => path.includes('playurl')).length, 1);
  });
}
test('ordinary video page extracts creator and collection metadata from its view response', async () => {
  const c = runtime();
  c.apiGet = async path => path.includes('/view?')
    ? { bvid: 'BVfixture', title: 'Fixture video', owner: { mid: 12345, name: 'Fixture UP' }, ugc_season: { id: 678, title: 'Fixture collection' }, pages: [{ cid: 9 }] }
    : { dash: { video: [{ id: 80, height: 1080, base_url: 'https://cdn.example/video' }] } };
  const out = await c.resolveVideoPage({ url: 'https://www.bilibili.com/video/BVfixture' });
  assert.deepEqual(JSON.parse(JSON.stringify(out.archiveMetadata)), {
    platform: 'bilibili', mediaKind: 'post', creatorId: '12345', creatorName: 'Fixture UP',
    collectionId: '678', collectionTitle: 'Fixture collection',
  });
});

test('uploader subscription resolver extracts creator metadata from fetched view without supplied context', async () => {
  const c = runtime();
  c.apiGet = async path => path.includes('/view?')
    ? { title: 'Fixture upload', owner: { mid: 4321, name: 'Actual UP' } }
    : { dash: { video: [{ id: 80, height: 1080, base_url: 'https://cdn.example/video' }] } };
  const out = await c.resolveUploaderVideo({ resolverItem: 'video:BVfixture:cid:9' });
  assert.deepEqual(JSON.parse(JSON.stringify(out.archiveMetadata)), {
    platform: 'bilibili', mediaKind: 'post', creatorId: '4321', creatorName: 'Actual UP',
  });
});

test('ordinary multi-P and UGC collections expose stable selectable children without fetching DASH', async () => {
  const c = runtime();
  const view = {
    bvid: 'BVone', title: 'First', owner: { mid: 8, name: 'Uploader' },
    pages: [{ cid: 9, part: 'Intro' }, { cid: 10, part: 'Main' }],
    ugc_season: { id: 11, title: 'Collection', sections: [
      { title: 'Group one', episodes: [{ bvid: 'BVone', cid: 9, title: 'First' }] },
      { title: 'Group two', episodes: [
        { bvid: 'BVtwo', arc: { first_cid: 12, title: 'Other...' } },
        { bvid: 'BVone', cid: 9, title: 'Repeated' },
      ] },
    ] },
  };
  const calls = [];
  c.apiGet = async path => {
    calls.push(path);
    return path.includes('/view?') ? view : { dash: { video: [{ id: 80, baseUrl: 'https://cdn.example/video' }] } };
  };
  const manifest = (await c.resolveVideoPage({ url: 'https://www.bilibili.com/video/BVone' })).manifest;
  assert.equal(manifest.name, 'Collection');
  assert.deepEqual(Array.from(manifest.items, item => [item.id, item.path]), [
    ['video:BVone:cid:9', 'Group one'], ['video:BVtwo:cid:12', 'Group two'], ['video:BVone:cid:10', ''],
  ]);
  assert.equal(manifest.items[1].name, 'Other.mp4');
  assert.equal(calls.length, 1);
  const chosen = await c.resolveVideoPage({ url: 'https://www.bilibili.com/video/BVone?p=2' });
  assert.match(calls.at(-1), /cid=10/);
  assert.match(chosen.fileName, /P2 Main/);
  await assert.rejects(c.resolveVideoPage({ url: 'https://www.bilibili.com/video/BVone?p=3' }), /指定分 P/);
});

test('attachment switches keep video selected alongside only the requested sidecars', async () => {
  const c = runtime();
  c.flux.settings.cover = true;
  c.flux.settings.danmakuXml = true;
  c.apiGet = async path => {
    assert.match(path, /\/view\?/);
    return { bvid: 'BV1nfj86AEAo', title: 'A video', pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg', pages: [{ cid: 14 }] };
  };
  const result = await c.resolve({ url: 'https://www.bilibili.com/video/BV1nfj86AEAo' });
  assert.deepEqual(Array.from(result.manifest.items, item => item.name.slice(item.name.lastIndexOf('.'))), [
    '.mp4', '.jpg', '.xml',
  ]);
  assert.equal(result.manifest.items[0].id, 'video:BV1nfj86AEAo:cid:14');
  const cover = await c.resolve({ url: 'https://www.bilibili.com/video/BV1nfj86AEAo', resolverItem: result.manifest.items[1].id });
  assert.equal(cover.url, 'https://i0.hdslb.com/bfs/archive/cover.jpg');
});

test('bangumi manifest carries series metadata from its season response', async () => {
  const c = runtime();
  c.seasonIdFromUrl = async () => '42';
  c.apiGet = async () => ({ season_id: 42, title: 'Fixture Series', episodes: [{ id: 1, title: 'Episode 1' }] });
  const out = await c.resolveManifest({ url: 'https://www.bilibili.com/bangumi/play/ss42' });
  assert.deepEqual(JSON.parse(JSON.stringify(out.manifest.archiveMetadata)), { platform: 'bilibili', mediaKind: 'series', seriesId: '42', seriesTitle: 'Fixture Series' });
});
test('bangumi episode result keeps series identity from the already fetched season', async () => {
  const c = runtime();
  c.apiGet = async path => path.includes('/season?')
    ? { season_id: 42, title: 'Fixture Series', episodes: [{ id: 1, title: 'Episode 1' }] }
    : { dash: { video: [{ id: 80, height: 1080, base_url: 'https://cdn.example/video' }] } };
  const out = await c.resolveEpisode({ resolverItem: 'ep:1' });
  assert.deepEqual(JSON.parse(JSON.stringify(out.archiveMetadata)), {
    platform: 'bilibili', mediaKind: 'series', seriesId: '42', seriesTitle: 'Fixture Series',
  });
});

test('manifest warns about failed quality enumeration without exposing request errors', async () => {
  const c = runtime();
  const warnings = [];
  c.pluginLog = (level, message, detail) => warnings.push({ level, message, detail });
  c.apiGet = async () => { throw new Error('SECRET-cookie'); };
  const items = await c.collectEpisodes({ episodes: [{ id: 1, title: '1' }, { id: 2, title: '2' }] }, false, {}, '', 'best');
  assert.deepEqual(Array.from(items, item => item.id), ['ep:1', 'ep:2']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].detail.failed, 2);
  assert.equal(JSON.stringify(warnings).includes('SECRET'), false);
});

test('manifest records quality reduction while keeping every episode', async () => {
  const c = runtime();
  const warnings = [];
  c.MAX_EPISODES = 3;
  c.pluginLog = (level, message, detail) => warnings.push({ level, message, detail });
  c.apiGet = async () => ({ dash: { video: [
    { id: 80, height: 1080, base_url: 'https://cdn.example/high' },
    { id: 64, height: 720, base_url: 'https://cdn.example/low' },
  ] } });
  const items = await c.collectEpisodes({ episodes: [{ id: 1, title: '1' }, { id: 2, title: '2' }] }, false, {}, '', 'best');
  assert.deepEqual(Array.from(items, item => item.id), ['ep:1@q:80', 'ep:2@q:80']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].detail.before, 4);
  assert.equal(warnings[0].detail.after, 2);
});

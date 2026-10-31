import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(fileURLToPath(new URL('../src/subscriptions.js', import.meta.url)), 'utf8');
function harness(settings = {}) {
  const context = vm.createContext({
    flux: { settings },
    setting: (name, fallback) => settings[name] == null ? fallback : settings[name],
    buildManifestVariantsFromPlay: () => [
      { qualityId: 120, height: 2160 }, { qualityId: 80, height: 1080 }, { qualityId: 64, height: 720 }, { qualityId: 32, height: 480 },
    ],
    selectListedQualityVariants: (variants, only) => only ? variants.slice(0, 1) : variants,
  });
  vm.runInContext(source, context);
  return context;
}

test('both subscription kinds use the plugin-wide quality and filtering settings', () => {
  const c = harness({ quality: '720', includeExtras: true, highestQualityOnly: true });
  for (const kind of ['bangumi', 'uploader']) {
    const options = c.subscriptionOptions(kind);
    const candidates = c.subscriptionQualityCandidates({}, 'video', options.highestQualityOnly, options.quality);
    assert.deepEqual(Array.from(candidates, variant => variant.height), [720]);
    assert.equal(options.includeExtras, true);
  }
});

test('quality ceiling chooses one variant at or below the requested height', () => {
  const c = harness();
  assert.deepEqual(Array.from(c.subscriptionQualityCandidates({}, 'x', false, '1080'), x => x.height), [1080]);
  assert.deepEqual(Array.from(c.subscriptionQualityCandidates({}, 'x', false, '480'), x => x.height), [480]);
});


test('episode quality identifiers remain deterministic and distinct', () => {
  const c = harness();
  const ids = Array.from(c.subscriptionQualityCandidates({}, 'x', false, 'best'), x => 'ep:123@q:' + x.qualityId);
  assert.deepEqual(ids, ['ep:123@q:120', 'ep:123@q:80', 'ep:123@q:64', 'ep:123@q:32']);
});

test('saved source overrides cannot supersede changed plugin settings', async () => {
  const settings = { quality: '720', includeExtras: true, highestQualityOnly: true };
  const c = harness(settings);
  Object.assign(c, {
    effectiveCookie: async () => '',
    seasonIdFromUrl: async () => '123',
    apiGet: async path => path.startsWith('/pgc/view/') ? {
      title: 'Series', episodes: [{ id: 1 }],
      section: [{ title: 'Extras', episodes: [{ id: 2 }] }],
    } : {},
    sanitizeFileName: text => text,
    filterBangumiEpisodes: episodes => episodes,
    episodeDisplayName: (_series, id) => 'Episode ' + id,
    playerPlayUrl: () => '/play',
    episodePageUrl: id => 'https://www.bilibili.com/bangumi/play/ep' + id,
    episodePubDate: () => '',
    pluginLog: () => {},
  });
  const request = {
    url: 'https://www.bilibili.com/bangumi/play/ss123',
    providerConfig: '{"quality":"2160","includeExtras":false,"highestQualityOnly":false,"limit":1}',
  };
  const first = await c.subscribeBangumi(request);
  assert.deepEqual(Array.from(first.items, item => item.resolverItem), ['ep:1@q:64', 'ep:2@q:64']);
  settings.quality = '480';
  const second = await c.subscribeBangumi({ ...request, providerConfig: 'obsolete non-JSON config' });
  assert.deepEqual(Array.from(second.items, item => item.resolverItem), ['ep:1@q:32', 'ep:2@q:32']);
});

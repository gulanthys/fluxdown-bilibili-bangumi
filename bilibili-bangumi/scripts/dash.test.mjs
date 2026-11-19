import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const runtime = readFileSync(fileURLToPath(new URL('../src/runtime.js', import.meta.url)), 'utf8');
const bangumi = readFileSync(fileURLToPath(new URL('../src/bangumi.js', import.meta.url)), 'utf8');
const dash = readFileSync(fileURLToPath(new URL('../src/dash.js', import.meta.url)), 'utf8');
const context = vm.createContext({ Date, Array, Object, String, Math, URL, flux: { settings: {} } });
vm.runInContext(`${runtime}\n${bangumi}\n${dash}`, context);

test('DASH quality fallback rejects missing requested ceilings and audio tracks', () => {
  assert.throws(() => context.chooseDashIndex([{ height: 720 }], '480'), /没有不超过 480p/);
  assert.throws(() => context.chooseDashIndex([{ height: 1080 }], 'audio'), /没有独立音频轨/);
  assert.throws(() => context.chooseDashIndex([], 'best'), /未返回可用画质/);
});

test('DASH consumer requires MP4 video and declared MP4-compatible audio metadata', () => {
  const audio = context.pickAudioTrack([
    { id: 1, bandwidth: 100, mimeType: 'audio/flac', base_url: 'https://cdn.example/flac' },
    { id: 2, bandwidth: 50, mimeType: 'audio/mp4; codecs="ec-3"', base_url: 'https://cdn.example/eac3' },
  ]);
  const variants = context.buildDashVariants([
    { id: 80, height: 1080, mimeType: 'video/mp4; codecs="hev1.1.6.L120"', base_url: 'https://cdn.example/hevc', size: 10 },
  ], audio, 'episode', {});
  assert.match(variants[0].fileName, /\.mp4$/);
  assert.equal(variants[0].container, 'mp4');
  assert.equal(variants[0].audioUrl, 'https://cdn.example/eac3');
  assert.throws(() => context.buildDashVariants([
    { id: 64, height: 720, mime_type: 'video/webm', base_url: 'https://cdn.example/webm' },
  ], audio, 'episode', {}), /非 MP4 视频流/);
});

test('DASH rejects supplied audio URLs when every declared audio format is incompatible', () => {
  assert.throws(() => context.pickAudioTrack([
    { id: 1, mime_type: 'audio/flac', base_url: 'https://cdn.example/flac' },
  ]), /不兼容 MP4\/M4A/);
  assert.equal(context.pickAudioTrack([]), null);
});

test('DASH missing media metadata preserves legacy MP4 and audio behavior', () => {
  const variants = context.buildDashVariants([
    { id: 80, height: 1080, base_url: 'https://cdn.example/video' },
  ], context.pickAudioTrack([
    { id: 1, base_url: 'https://cdn.example/audio' },
  ]), 'episode', {});
  assert.match(variants[0].fileName, /\.mp4$/);
  assert.equal(variants[0].audioUrl, 'https://cdn.example/audio');
  assert.match(variants[1].fileName, /\.m4a$/);
});

test('multi-part durl is rejected rather than returning an incomplete first segment', () => {
  assert.throws(() => context.buildVariantsFromPlay({ durl: [
    { quality: 80, url: 'https://cdn.example/part-1.flv', size: 10 },
    { quality: 80, url: 'https://cdn.example/part-2.flv', size: 10 },
  ] }, 'episode'), /分段 durl/);
});

test('video codec preference changes only the chosen track within each quality', () => {
  context.flux.settings.videoCodec = 'av1';
  try {
    const variants = context.buildVariantsFromPlay({ dash: { video: [
      { id: 80, height: 1080, codecs: 'avc1.64002a', baseUrl: 'https://cdn.example/avc' },
      { id: 80, height: 1080, codecs: 'av01.0.08M.08', baseUrl: 'https://cdn.example/av1' },
      { id: 64, height: 720, codecid: 12, baseUrl: 'https://cdn.example/hevc' },
    ] } }, 'video');
    assert.deepEqual(Array.from(variants, variant => variant.url), [
      'https://cdn.example/av1', 'https://cdn.example/hevc',
    ]);
  } finally {
    delete context.flux.settings.videoCodec;
  }
});

test('requested audio falls back down before up, and FLAC is not mislabeled M4A', () => {
  const dash = {
    audio: [{ id: 30280, baseUrl: 'https://cdn.example/aac', bandwidth: 192000 }],
    flac: { audio: { mimeType: 'audio/flac', baseUrl: 'https://cdn.example/flac', bandwidth: 1000000 } },
  };
  context.flux.settings.audioQuality = '30250';
  try {
    assert.equal(context.dashAudioTrack(dash).baseUrl, 'https://cdn.example/aac');
    context.flux.settings.audioQuality = '30251';
    context.flux.settings.quality = 'audio';
    const result = context.resolvePlayResult({ dash }, 'lossless', '', {}, {});
    assert.equal(result.url, 'https://cdn.example/flac');
    assert.match(result.fileName, /\.flac$/);
  } finally {
    delete context.flux.settings.audioQuality;
    delete context.flux.settings.quality;
  }
});

test('fixed DASH quality retains separate video and audio sources and mirrors', () => {
  const result = context.resolvePlayResult({ dash: {
    video: [{ id: 80, baseUrl: 'https://video.example/main',
      backupUrl: ['https://video.example/main', 'https://video.example/backup', 'http://video.example/insecure'] }],
    audio: [{ id: 30280, baseUrl: 'https://audio.example/main', backupUrl: ['https://audio.example/backup'] }],
  } }, 'video', '80', {}, {});
  assert.equal(result.audioUrl, 'https://audio.example/main');
  assert.deepEqual(Array.from(result.backupUrls), ['https://video.example/backup']);
  assert.deepEqual(Array.from(result.audioBackupUrls), ['https://audio.example/backup']);
});

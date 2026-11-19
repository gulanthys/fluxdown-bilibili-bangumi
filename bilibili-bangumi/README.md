# Bilibili Plugin

`gulanthys@bilibili-bangumi` is FluxDown's Bilibili content parsing and subscription plugin. Playback routing, supplementary resources, and episode lists are handled by the host; the plugin does not provide a separate download engine.

## Features

- Supports Bilibili series playback pages: `/bangumi/play/ss...` and `/bangumi/play/ep...`
- Supports Bilibili series media pages: `/bangumi/media/md...`
- Supports series playback and media pages with a `season_id` parameter
- Opens an episode list for regular multi-part videos and UGC collections without `?p=N`; collections are grouped by section. With `?p=N`, resolves only that part.
- Supports mobile Bilibili series and regular video links
- Supports `b23.tv` and `bili2233.cn` short links, expanded into regular video, series, or subscription flows
- Automatically discovers main-series episodes and creates a download task per episode
- Optionally discovers extras, previews, PVs, interviews, and other sections
- Supports DASH video quality selection: best, 2160p, 1440p, 1080p, 720p, and 480p
- Supports audio-only downloads, with container determined by the actual audio track; supports AVC, HEVC, AV1, and 64K, 132K, 192K, Dolby, and Hi-Res audio quality
- Creates a separate download item for each available quality, retaining the original video name and appending the quality (for example, `[1080p-高清]`)
- FluxDown merges audio and video; supplementary-resource settings allow covers, human/AI subtitles (SRT), and XML/ASS danmaku to be selected independently in episode lists
- Supports browser Cookie headers and Netscape `cookies.txt`, filtering Netscape cookies by Bilibili API domain
- Supports the portable FD `auth` view: displays a Bilibili login QR code when signed out and a success state when signed in; the auth profile is reused for subsequent parsing
- Supports `bilibili-bangumi` provider subscriptions for series and UP creator submissions; the host handles polling, deduplication, and download task creation
- The GPUI and Web “Bilibili Library” activity accepts IDs, links, or share text, and can enqueue items from watch history, favorites, likes, and UP creator collections
- Series and UP creator subscriptions share the plugin's quality and filtering settings
- Truncates filenames to FluxDown's manifest path-length limit and numbers duplicate entries in the same directory
- Regular video links support BV IDs and `av` plus numeric IDs; AV links use the video information API to read the corresponding BV ID and parts

## Language support

Settings use the host's manifest `localizations` fields for English (`en`) and Simplified Chinese (`zh-Hans`), including option labels localized by option value. Some host-rendered labels are fixed strings and cannot be localized by a plugin: the plugin name and description, activity/auth view titles, and other manifest labels without localization support use neutral branding or English instead.

Portable views choose their language from the live host locale: every locale tag beginning with `zh` (including regional tags and underscore variants) uses Simplified Chinese; all other locales, including an omitted locale, use English. Externally sourced titles and native resolver text are not automatically translated unless a locale-aware translation is explicitly provided; Bilibili-provided titles and host-rendered resolver text may therefore remain in their original language.

## Requirements

- FluxDown `0.6.9` or a development build with an equivalent plugin protocol; older hosts do not support this version's generated subtitle/ASS files and track fallback URLs.
- Access to `api.bilibili.com`
- A valid Bilibili Cookie for content requiring login
- FFmpeg installed or configured in FluxDown component settings to merge DASH audio and video

## Installation

### Install from a `.fxplug` package

In FluxDown, choose the `.fxplug` package from **Settings → Extensions → Plugins**; enable the plugin after installation.

The root of the `.fxplug` package must contain `manifest.json`, `resolve.js`, `auth.js`, and `main.js`; a development install directory must also contain those files directly. `main.js` embeds a QR encoder under the MIT license, so no additional runtime dependency is required.

## Configuration

After installing the plugin, configure these settings in the plugin card:

| Setting | Description | Default |
| --- | --- | --- |
| Import Bilibili Cookies | Browser Cookie request header or Netscape `cookies.txt` content; Netscape import accepts only Bilibili-domain and root-path cookies | Empty |
| Include Extras and Behind-the-Scenes | Also list extras, previews, PVs, interviews, and other sections in series lists and subscriptions | Off |
| Prefer Highest Quality | List only the highest available quality per video in series lists and series/UP creator subscriptions | Off |
| Default Quality | Default for regular links; shared quality ceiling for series and UP creator subscriptions | Best quality |
| Video Codec Preference | AVC / HEVC / AV1; falls back to a compatible codec at the same quality when the selected codec is unavailable | Auto |
| Audio Quality Preference | Selects 64K through Hi-Res; prefers a lower available tier if the selected tier is unavailable | Auto (standard audio) |
| Covers, human subtitles, AI subtitles, XML / ASS danmaku | Individually controls supplementary resources in regular video, collection, and series lists | Off |

Explicit Cookies are saved in the local plugin configuration; QR login credentials are managed by the FluxDown auth profile. Do not share or submit Cookies. If they expire, scan again or import a valid Cookie.

## Login

Click **Authenticate/Login** in the plugin card:

1. The plugin first validates the saved login state with Bilibili. If valid, it shows the login success page without creating a QR code. Otherwise it automatically displays a QR code and scan instructions; it does not show a site, login-information, or “start login” form.
2. Scan and confirm using the Bilibili app.
3. The plugin checks the scan result every two seconds. On success it saves the auth Cookie, stops polling, and switches to the success page without automatically closing the window.
4. Subsequent parsing reuses the saved login state, so scanning is not required again until the auth expires.

The status query validates the API auth profile with Bilibili `/x/web-interface/nav`; a server-revoked login is no longer shown as signed in. Network failures report that the status could not be checked temporarily and do not delete credentials.

Closing the window stops polling and clears the QR session without deleting saved credentials. If the QR expires or a request fails, choose **Refresh QR code**. After login, a new QR code is created only by explicitly choosing **Scan again**; the old auth profile is kept until the new account is confirmed. This view does not provide a logout or account-input form.

## Usage

1. Copy a Bilibili series playback page, media page, or BV/AV regular video link.
2. Give the link to FluxDown to create a download task.
3. Series, multi-part, UGC collection, and links with supplementary resources enabled return a selectable list. A single video usually returns quality choices directly; use `?p=N` to select a specific part.
4. FluxDown obtains a short-lived playback URL and starts the download.

Episodes are named with the series title and episode number; extras and other sections are placed in their corresponding subdirectories.

### Library

Open **Bilibili Library** from the activity bar in GPUI or Web. Paste share text or enter a BV, AV, EP, SS, or numeric AV ID, then choose **Add to queue**. Tasks are created paused and can be started from the downloads list after review.

Watch history, favorites, and account likes reuse the plugin login state; a public creator collection can be specified by UID. Select entries and add them in batches of up to 20. A failed item does not re-enqueue items already created in the same batch. Regular creator submissions enqueue the part indicated by the list, or part 1 when unspecified; they do not enqueue the entire UGC collection. Login is required to use content from your own account. The `tasks` permission is used to create tasks and must be authorized in the client after upgrading.

## Parsing flow

The plugin operates in two stages:

1. Series link → calls Bilibili's series API and reads the episode list.
2. BV/AV link → queries video information; selects one part using `?p=N`, or returns a regular multi-part/UGC collection list.
3. Series episode or subscription video ID → calls the playback API for a short-lived direct URL, then returns it to FluxDown.

FluxDown core handles subscription polling, deduplication, and subscription task creation. The library submits regular download tasks only after user confirmation.

## Series subscriptions

In FluxDown's RSS/subscription wizard, choose `Bilibili Series · bilibili-bangumi` as the source and enter a series playback page, media page, or episode page, for example:

```text
https://www.bilibili.com/bangumi/play/ss12345
```

Subscriptions use **Default Quality**, **Include Extras and Behind-the-Scenes**, and **Prefer Highest Quality** from **Settings → Extensions → Plugins → Bilibili → Settings**; there are no duplicate subscription-level settings. Subsequent subscription fetches use updated plugin settings; existing download tasks are unaffected.

Each series poll checks at most the 50 most recent episodes; each UP creator poll checks at most the 20 most recent submissions. The quality ceiling selects the highest available quality no greater than the chosen height; **Audio only** is not supported for subscriptions and is treated as best quality. Entry titles show the actual quality, and the core passes the selected quality back to the plugin for second-stage resolution. Playback URLs are short-lived and may need to be re-resolved or retried after a long pause.

Filter settings can still filter qualities by title, for example include `1080p|720p` or exclude `HDR`. Do not enable **Smart Episode Deduplication** if multiple qualities for the same episode should be retained.

## Troubleshooting

### The installer does not show the `.fxplug` file

`.fxplug` is a zip-format plugin package. Select the file directly; do not extract and re-compress it.

### Parsing fails after installation

Check the following:

- The client is at least version `0.6.9` (older clients can continue using plugin `1.1.3`).
- The plugin is enabled.
- The Bilibili link is a supported series page, BV/AV regular video page, or corresponding short link.
- The Bilibili Cookie is valid and has access to the content.
- The client can access `api.bilibili.com`.

### Only some qualities are listed

The qualities Bilibili returns depend on account permissions, the video, and the current playback API response. The plugin lists only the qualities actually returned by the API; the default quality cannot grant permissions the account does not have.

A failed request for a selected list quality reports an error rather than switching to the default-quality API. Episodes whose quality enumeration fails remain as retryable entries, and the failure count is recorded. When quality entries exceed the host's 1000-item limit, each episode is reduced to its highest available quality, with counts before and after reduction recorded. Partial subscription failures, missing metadata, and recent-episode range limits are also recorded in diagnostic logs; Cookies and raw request errors are not logged.

DASH video uses MP4. AVC / HEVC / AV1 and audio tiers can be selected in settings; independent audio is named according to its actual container, and FLAC is not mislabeled as M4A. Subtitles download only tracks provided by Bilibili; there is no local transcription. ASS renders ordinary scrolling, reverse scrolling, top, and bottom danmaku; original XML preserves site-provided content.

### Download URLs expire quickly

Playback URLs are short-lived. FluxDown re-resolves them on start or resume. Hosts supporting this protocol version can also refresh a rejected route during download and try that route's fallback CDN on network errors.

## Files

- `manifest.json`: plugin identity, match rules, settings, and entry declarations.
- `resolve.js`: Bilibili series episode discovery, Cookie handling, DASH/FLV URL resolution, and quality selection.
- `auth.js`: QR login session, polling, and auth profile storage.
- `main.js`: portable QR login view and local PNG encoding, with no third-party QR image request.

## Version

Current version: `1.2.0`

`1.2.0`: regular multi-part and UGC collection selection; covers, human/AI subtitles, and danmaku; audio and codec preferences; library and share-text input; per-track direct URL recovery and fallback CDN.

`1.1.1`: removed duplicate subscription-level settings, made series and UP creator subscriptions follow plugin settings; old subscriptions' saved `providerConfig` no longer overrides these settings.

`1.1.0`: unified auth profile semantics for QR and manual Cookie login; removed an ineffective session reuse toggle; added subscription-level `providerConfig`; fixed Cookie domain filtering, quality fallback, and manifest path length limits; rejects incomplete multi-segment durl.

Fixes: selected-quality failures no longer switch to the default API; login status gains server-side validation; DASH media MIME is validated and incompatible containers are rejected; added diagnostics for quality-list reduction and individual failures.

Auth cleanup compatibility fix: FD's `flux.storage` provides only `get/set`; old Cookie cache is cleared with `set('auth.cookie', '')`, and login save/logout no longer call the nonexistent `storage.remove`. Auth profiles are still removed through `flux.auth.remove`; test doubles match the host API.

Login view: declares `contributes.views[].location = "auth"`; GPUI and Web share QR and login-success pages. It restores a valid login state on opening, stays on the success page after scanning, creates a new QR only when explicitly requested, and cleans up the session on close. Minimum FD version was `0.6.4`.

## UP creator subscriptions

In the RSS/subscription wizard, choose `bilibili-bangumi` and enter a creator space, for example:

```text
https://space.bilibili.com/123456
```

Each poll reads at most the 20 newest submissions. Quality and **Prefer Highest Quality** follow plugin settings, and stable entries are generated by bvid + cid; the core handles polling and deduplication. Live replays, collection subscriptions, and advanced keyword filtering are not supported. Submission lists use Bilibili's WBI-signed API; the plugin caches and automatically refreshes the WBI key, reusing the existing auth Cookie settings.

## Source structure

The runtime entry remains the root `resolve.js`; source is split by responsibility in `src/`:

- `runtime.js`: plugin runtime, Cookie, HTTP, and Bilibili API fundamentals
- `bangumi.js`: series episode discovery and individual episode parsing
- `dash.js`: DASH, audio tracks, quality, and download result handling
- `subscriptions.js`: series and UP creator subscriptions
- `entry.js`: `resolve` and `subscribe` entry points exposed to FluxDown
- `resources.js`: supplementary resource lists, subtitle metadata, and SRT/ASS conversion
- `input.js`, `library-view.js`: ID and share-text normalization, library activity view
- `auth-view.js`: QR view state and session lifecycle
- `qr-image.js`: sandbox PNG encoding; QR matrix uses FD's existing node-qrcode 1.5.4 encoder (`vendor/qrcode.js`, license in `vendor/LICENSE-qrcode`)

After modifying source, run this in the plugin directory:

```text
node scripts/build.mjs
```

This regenerates root `resolve.js` and `main.js`; the installed plugin uses the entries declared in `manifest.json`.

## Short links

Enter `https://b23.tv/...` or `https://bili2233.cn/...` directly. A regular video short link uses video parsing; a series short link returns an episode list. The subscription wizard also accepts short links pointing to a series or creator space.

The host follows redirects but does not provide the final URL to the plugin. The plugin reads the target from canonical / Open Graph metadata on the landing page and does not execute page scripts. If the video landing page includes part-selection state, it is preserved.

Captcha pages, truncated pages, pages without canonical links, and unsupported activity pages return an explicit error. In those cases, open the short link in a browser and copy the full URL. Short-link expansion does not carry task Cookies; subsequent video and series parsing continues to use the existing login state.

Regression checks (run in the plugin directory):

```text
node scripts/build.mjs
node --test scripts/shortlinks.test.mjs
```

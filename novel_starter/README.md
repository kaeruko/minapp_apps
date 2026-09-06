# Novel Player reference (`minapp/novel@1`)

Tracks `kaeruko/minapp_apps#1` and the shared Authoring contract in `kaeruko/minapp#98`.

This directory is the reference Player for the first editable content format:

```text
minapp/novel@1
```

The implementation order is intentionally Player-first. The Editor is not implemented here yet.

## Files

- `story.schema.json` — formal JSON Schema for `minapp/novel@1`
- `story-validator.js` — fail-fast semantic validation that also checks cross references
- `player.js` — generic event-driven Player
- `index.html` — published-artifact style sample with Master Data embedded as `application/json`
- `face.jpg` — sample character asset
- `test_story_validator.js` — dependency-free Node checks for important validation failures
- `test_player_runtime_ready.js` — dependency-free Hosted bridge readiness regression check

## v1 event types

Every scene and event has a stable ID independent of display order.

Supported events:

```text
background
character (show / hide)
dialogue
choice
bgm (play / stop)
se
end
```

`choice.options[].goto` targets a scene ID. Event IDs must be unique across the entire work so saved progress can identify a stable resume point.

A scene must end in `choice` or `end`. Falling off the end of a scene is invalid rather than being silently interpreted as an ending.

## Fail-fast behavior

The validator rejects, without fallback:

- a `content_format` other than exact `minapp/novel@1`
- unsupported schema versions
- unknown fields or event types
- duplicate event IDs
- scene key / `scene.id` mismatches
- missing `goto` targets
- missing characters / expressions / assets
- image/audio kind mismatches
- unsafe relative asset paths
- malformed or unterminated scenes

The Player does not skip unknown events or substitute another asset/path/type.

## Embedded Master Data

For v1 the Player does not require `fetch('story.json')`. The publish compiler can embed validated Master Data into:

```html
<script id="minapp-novel-story" type="application/json">
  { ... }
</script>
```

This keeps the scenario as data rather than generating scenario-specific JavaScript and avoids making relative JSON fetch behavior a requirement of the initial Hosted CSP/runtime contract.

`story.json` remains the logical Authoring source of truth; embedding is a publish-artifact representation.

## Save / resume contract

The Player never falls back from private progress to shared `minapp.state`.

When running inside a MinApp Host, the native JavaScript channel may exist before `window.minapp` is injected. In that case the Player stays in an explicit `ホスト接続待ち` state and waits for `minappready`; it does not silently enter standalone mode.

Once the Host bridge is ready, the Player requires:

```js
minapp.userState.get(key)
minapp.userState.set(key, value)
minapp.userState.delete(key)
```

If the Host exists but does not provide `minapp.userState`, startup fails with `user_state_unavailable`.

When opened as a plain standalone web page with neither the Host channel nor `window.minapp`, the sample can be played explicitly in no-save preview mode.

Saved progress includes:

```json
{
  "schema_version": 1,
  "content_format": "minapp/novel@1",
  "content_revision": 1,
  "scene_id": "start",
  "event_id": "evt-start-line",
  "state": {
    "background": null,
    "characters": {
      "left": null,
      "center": {
        "character_id": "ren",
        "expression": "normal"
      },
      "right": null
    },
    "bgm": null
  }
}
```

A save from another content revision is rejected as `incompatible_save`. It is not silently migrated. The UI may offer an explicit user action to delete that save and start over.

Preview state isolation itself belongs to the shared Runtime/Authoring implementation in `kaeruko/minapp#98`; the Player only uses the scoped `minapp.userState` surface provided by its session.

## Validation check

No package install is required:

```bash
node novel_starter/test_story_validator.js
node novel_starter/test_player_runtime_ready.js
node --check novel_starter/story-validator.js
node --check novel_starter/player.js
```

The shared Runtime/Authoring substrate now provides `minapp.userState`, audio delivery, Runtime session renewal, preview state isolation, draft/asset Authoring storage, scoped Authoring sessions, and immutable publish. The next Novel-specific step is to connect the Editor to that contract.

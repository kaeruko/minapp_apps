# Novel reference (`minapp/novel@1`)

Tracks `kaeruko/minapp_apps#1` and the generic Authoring contract in `kaeruko/minapp`.

This repository contains the Novel-specific reference implementation only. The Host stays format-agnostic and selects Editor/Player by exact `content_format` contracts.

## Packages

### `novel_starter`

Reference Player for:

```text
minapp/novel@1
```

- `story.schema.json` — formal JSON Schema
- `story-validator.js` — fail-fast semantic validation and cross-reference checks
- `player.js` — JSON-driven Player
- `index.html` — published-artifact style sample with Master Data embedded as `application/json`
- `face.jpg` — sample asset
- runtime and validation regression tests

### `novel_editor`

Reference Editor for the same exact format.

The Editor:

- initializes only an exact empty `{}` Authoring document
- rejects malformed non-empty documents instead of reinitializing them
- loads/saves through `minapp.authoring`
- creates and edits characters + expressions and scenes while keeping stable IDs
- creates, deletes, and reorders every v1 event type through validated structural mutations
- edits dialogue `speaker`, choice/goto targets, character show/hide + slot/character/expression, background, BGM, and SE assignments
- uploads/replaces/previews/deletes image/audio assets through the scoped Authoring asset bridge and surfaces orphan cleanup explicitly
- uses Host-driven `minapp.authoring.preview()` with the real Novel Player
- requires a successful Preview of the current Draft before enabling Publish
- validates the current generic Publish response including the pinned Player identity/version
- never receives a Cognito token or chooses a backend directly

## v1 event types

Every scene/event/choice has a stable ID independent of display order.

Supported events:

```text
background
character (show / hide)
dialogue
choice
goto
bgm (play / stop)
se
end
```

`choice.options[].goto` and an explicit `goto` event both target scene IDs. Event IDs are unique across the work so saved progress can identify a stable resume point.

A scene must end in `choice`, `goto`, or `end`. Falling off a scene is invalid. The Player also bounds an automatic-only event chain and fails with `automatic_event_loop` instead of hanging on an unconditional cycle.

## Fail-fast behavior

The validator rejects, without fallback:

- a `content_format` other than exact `minapp/novel@1`
- unsupported schema versions
- unknown fields or event types
- duplicate event IDs
- scene key / `scene.id` mismatches
- missing transition targets
- missing characters / expressions / assets
- image/audio kind mismatches
- unsafe relative asset paths
- malformed or unterminated scenes

The Player never skips unknown events or substitutes another asset/path/type. The Editor also refuses invalid structural deletion/reordering and preserves Authoring revision/scope errors rather than retrying through another path.

## Embedded Master Data

The Player does not require `fetch('story.json')`. Publish embeds validated Master Data into the Player artifact:

```html
<script id="minapp-novel-story" type="application/json">
  { ... }
</script>
```

The Authoring document remains the editable source of truth; the embedded JSON is the immutable publish representation.

## Save / resume contract

The Player never falls back from private progress to shared `minapp.state`.

Inside a MinApp Host it requires:

```js
minapp.userState.get(key)
minapp.userState.set(key, value)
minapp.userState.delete(key)
```

If the native Host channel exists before `window.minapp` is injected, the Player waits for `minappready`. If the Host exists without `minapp.userState`, startup fails with `user_state_unavailable`. A plain standalone page is an explicit no-save mode only.

Saved progress includes stable location and display state:

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

`content_revision` is a **save-compatibility epoch**, not the Authoring Draft revision. Ordinary title/dialogue/scene edits preserve it, so a normal republish does not invalidate every user's progress. A deliberate incompatible story change may explicitly bump it; an older save then fails as `incompatible_save` and is never silently migrated.

The Authoring Draft revision is a separate platform revision used for optimistic concurrency, Preview pinning, and Publish pinning.

## Authoring reference flow

```text
Host creates document: {}
  -> Novel Editor initializes exact {}
  -> add assets / characters / expressions / scenes / events
  -> save Draft
  -> Host-driven Preview with compatible Novel Player
  -> Publish the same pinned Draft/Player selection
  -> later load the same content_id and re-edit
```

Preview uses the platform's isolated Runtime/userState namespace. The Editor does not contain a second simplified Player.

## Assets

Novel v1 supports image and audio asset references in the document. The generic Authoring backend and Host adapters expose scoped `getAsset` / `saveAsset` / `deleteAsset` operations with optimistic revision checks. The Novel Editor uses only that trusted bridge: it supplies validated relative paths, bytes, and `expectedRevision`, while backend credentials and scope stay in the Host.

Asset and document mutations deliberately remain separate. The Editor does not auto-retry a stale revision or perform hidden rollback fallback. If a multi-step operation stops after storing bytes, the remaining unreferenced server asset is shown for explicit cleanup.

## Validation check

No package install is required:

```bash
node novel_starter/test_story_validator.js
node novel_starter/test_player_runtime_ready.js
node novel_editor/test_editor_core.js
node novel_editor/test_asset_tools.js
node --check novel_starter/story-validator.js
node --check novel_starter/player.js
node --check novel_editor/story-validator.js
node --check novel_editor/editor-core.js
node --check novel_editor/asset-tools.js
node --check novel_editor/editor.js
```

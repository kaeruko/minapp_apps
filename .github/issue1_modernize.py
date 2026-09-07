from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Player: explicit goto is part of minapp/novel@1. Bound automatic-only chains so
# malformed/cyclic authored content fails instead of hanging the WebView.
replace_once(
    "novel_starter/player.js",
    "  async function runUntilPause() {\n    ended = false;\n    while (true) {",
    "  async function runUntilPause() {\n    ended = false;\n    let automaticSteps = 0;\n    while (true) {\n      automaticSteps += 1;\n      if (automaticSteps > 1000) {\n        throw Object.assign(new Error('automatic event chain exceeded 1000 steps'), { code: 'automatic_event_loop' });\n      }",
)
replace_once(
    "novel_starter/player.js",
    "        case 'end': {",
    "        case 'goto':\n          sceneId = event.goto;\n          eventIndex = 0;\n          break;\n        case 'end': {",
)

# Formal JSON Schema mirrors the semantic validator exactly.
schema_path = Path("novel_starter/story.schema.json")
schema = json.loads(schema_path.read_text(encoding="utf-8"))
defs = schema["$defs"]
if "gotoEvent" in defs:
    raise RuntimeError("story schema already contains gotoEvent")
defs["gotoEvent"] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "type", "goto"],
    "properties": {
        "id": {"$ref": "#/$defs/id"},
        "type": {"const": "goto"},
        "goto": {"$ref": "#/$defs/id"},
    },
}
event_refs = defs["event"]["oneOf"]
choice_index = next(
    (index for index, item in enumerate(event_refs) if item.get("$ref") == "#/$defs/choiceEvent"),
    None,
)
if choice_index is None:
    raise RuntimeError("story schema choiceEvent reference not found")
event_refs.insert(choice_index + 1, {"$ref": "#/$defs/gotoEvent"})
schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Validator regression: explicit goto is valid and its target must exist.
replace_once(
    "novel_starter/test_story_validator.js",
    "assert.equal(validateStory(validStory()).content_format, FORMAT);\n",
    "assert.equal(validateStory(validStory()).content_format, FORMAT);\n\n{\n  const story = validStory();\n  story.scenes.start.events = [{ id: 'jump', type: 'goto', goto: 'finish' }];\n  story.scenes.finish = { id: 'finish', events: [{ id: 'finish-end', type: 'end' }] };\n  assert.equal(validateStory(story).scenes.start.events[0].type, 'goto');\n}\n",
)
replace_once(
    "novel_starter/test_story_validator.js",
    "expectCode((story) => { story.characters.ren.expressions.normal = 'missing'; }, 'missing_asset');",
    "expectCode((story) => {\n  story.scenes.start.events = [{ id: 'jump', type: 'goto', goto: 'missing' }];\n}, 'missing_scene');\nexpectCode((story) => { story.characters.ren.expressions.normal = 'missing'; }, 'missing_asset');",
)

# The runtime readiness suite also guards that the Player implementation—not
# merely the schema—contains the explicit goto path and loop fail-fast guard.
replace_once(
    "novel_starter/test_player_runtime_ready.js",
    "const playerSource = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');\n",
    "const playerSource = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');\nassert.match(playerSource, /case 'goto':[\\s\\S]*sceneId = event\\.goto;[\\s\\S]*eventIndex = 0;/);\nassert.match(playerSource, /automatic_event_loop/);\n",
)

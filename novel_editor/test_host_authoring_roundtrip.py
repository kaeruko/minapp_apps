from __future__ import annotations

import base64
import io
import pathlib
import sys
import unittest
import zipfile
from typing import Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST_ROOT = ROOT / "external" / "minapp"
HOST_BACKEND = HOST_ROOT / "backend"
HOST_SRC = HOST_BACKEND / "src"
HOST_TESTS = HOST_BACKEND / "tests"

if not HOST_SRC.is_dir() or not HOST_TESTS.is_dir():
    raise RuntimeError(
        "generic Host checkout is required at external/minapp; "
        "the Novel reference test does not fall back to another Host source"
    )

for path in (HOST_SRC, HOST_TESTS):
    path_text = str(path)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)

import hosted_authoring_launch  # noqa: E402
import hosted_authoring_preview  # noqa: E402
import hosted_authoring_session  # noqa: E402
import hosted_upload  # noqa: E402
from hosted_authoring_indexed_backend import HostedAuthoringIndexedBackend  # noqa: E402
from hosted_authoring_publish_backend import HostedAuthoringPublishBackend  # noqa: E402
from hosted_legal import PRIVACY_VERSION, TERMS_VERSION  # noqa: E402
from test_hosted_backend import FakeCognito  # noqa: E402
from test_hosted_catalog_backend import FakeS3  # noqa: E402
from test_hosted_third_party_authoring_roundtrip import RoundTripDynamoDb  # noqa: E402


EDITOR_FILES = (
    "index.html",
    "story-validator.js",
    "editor-core.js",
    "asset-tools.js",
    "editor.js",
)
PLAYER_FILES = (
    "index.html",
    "story-validator.js",
    "player.js",
)

# 1x1 transparent PNG. The Authoring backend treats assets as opaque bytes and
# validates path/type/revision; image decoding belongs to the Player/browser.
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def source_zip(root: pathlib.Path, names: Iterable[str]) -> bytes:
    if not root.is_dir():
        raise RuntimeError(f"source directory does not exist: {root}")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            path = root / name
            if not path.is_file():
                raise RuntimeError(f"required source file does not exist: {path}")
            archive.writestr(name, path.read_bytes())
    return output.getvalue()


def novel_document(text: str) -> dict[str, object]:
    if not isinstance(text, str) or not text:
        raise TypeError("text must be a non-empty string")
    return {
        "content_format": "minapp/novel@1",
        "schema_version": 1,
        "content_revision": 1,
        "title": "Generic Host Novel Roundtrip",
        "start_scene": "scene_001",
        "assets": {
            "hero": {
                "kind": "image",
                "src": "assets/hero.png",
                "mime": "image/png",
                "alt": "Hero",
            }
        },
        "characters": {
            "hero": {
                "name": "Hero",
                "expressions": {"normal": "hero"},
            }
        },
        "scenes": {
            "scene_001": {
                "id": "scene_001",
                "events": [
                    {
                        "id": "event_001",
                        "type": "character",
                        "action": "show",
                        "slot": "center",
                        "character": "hero",
                        "expression": "normal",
                    },
                    {
                        "id": "event_002",
                        "type": "dialogue",
                        "speaker": "hero",
                        "text": text,
                    },
                    {
                        "id": "event_003",
                        "type": "end",
                        "label": "END",
                    },
                ],
            }
        },
    }


class NovelGenericAuthoringRoundtripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cognito = FakeCognito()
        self.metadata = RoundTripDynamoDb()
        self.runtime = RoundTripDynamoDb()
        self.s3 = FakeS3()
        kwargs = dict(
            cognito=self.cognito,
            dynamodb=self.metadata,
            runtime_dynamodb=self.runtime,
            s3=self.s3,
            user_pool_id="pool",
            app_client_id="client",
            table_name="metadata",
            runtime_table_name="runtime",
            upload_bucket="uploads",
            published_bucket="published",
        )
        self.indexed = HostedAuthoringIndexedBackend(**kwargs)
        self.publisher = HostedAuthoringPublishBackend(**kwargs)

        self.indexed.register("alice", "secret12", TERMS_VERSION, PRIVACY_VERSION)
        self.indexed.register("bob", "secret12", TERMS_VERSION, PRIVACY_VERSION)
        self.alice = self.cognito.users["alice"]["sub"]
        self.bob = self.cognito.users["bob"]["sub"]
        group = self.indexed.create_group(self.alice, "Novel Lab")
        self.group_id = group["group_id"]
        invite = self.indexed.create_invite(self.alice, self.group_id)
        self.indexed.join_group(self.bob, invite["code"])

        self.editor = hosted_upload.create_uploaded_app(
            self.indexed,
            self.alice,
            self.group_id,
            "Novel Editor Reference",
            source_zip(ROOT / "novel_editor", EDITOR_FILES),
        )
        self.indexed.register_authoring_contract(
            self.alice,
            self.group_id,
            self.editor["app_id"],
            edits=["minapp/novel@1"],
            accepts=[],
            master_data_element_id=None,
        )
        self.indexed.publish_app(
            self.alice,
            self.group_id,
            self.editor["app_id"],
            expected_revision=1,
        )

        self.player = hosted_upload.create_uploaded_app(
            self.indexed,
            self.alice,
            self.group_id,
            "Novel Player Reference",
            source_zip(ROOT / "novel_starter", PLAYER_FILES),
        )
        self.indexed.register_authoring_contract(
            self.alice,
            self.group_id,
            self.player["app_id"],
            edits=[],
            accepts=["minapp/novel@1"],
            master_data_element_id="minapp-novel-story",
        )
        self.indexed.publish_app(
            self.alice,
            self.group_id,
            self.player["app_id"],
            expected_revision=1,
        )

    def test_real_novel_editor_and_player_roundtrip_through_generic_host(self) -> None:
        contracts = self.indexed.list_authoring_apps(self.bob, self.group_id)
        self.assertEqual(
            {item["app_id"] for item in contracts},
            {self.editor["app_id"], self.player["app_id"]},
        )

        project = self.indexed.create_authoring_project(
            self.bob,
            self.group_id,
            "minapp/novel@1",
            {},
        )
        content_id = project["content_id"]
        self.assertEqual(
            self.indexed.load_authoring_project(self.bob, content_id)["document"],
            {},
        )

        launch = hosted_authoring_launch.create_launch(
            self.indexed,
            self.bob,
            content_id,
            self.editor["app_id"],
        )
        editor_token = launch["content_path"].split("/")[3]
        editor_index, editor_index_type = hosted_authoring_launch.get_editor_file(
            self.indexed,
            editor_token,
            "index.html",
        )
        editor_js, editor_js_type = hosted_authoring_launch.get_editor_file(
            self.indexed,
            editor_token,
            "editor.js",
        )
        self.assertEqual(editor_index_type, "text/html; charset=utf-8")
        self.assertEqual(editor_js_type, "text/javascript; charset=utf-8")
        self.assertIn("ノベルゲームメーカー".encode("utf-8"), editor_index)
        self.assertIn(b"minapp.authoring", editor_js)
        self.assertNotIn(b"Authorization", editor_js)
        self.assertNotIn(b"Cognito", editor_js)

        authoring_token = launch["authoring_token"]
        capability_loaded = hosted_authoring_session.load_project(
            self.indexed,
            authoring_token,
        )
        self.assertEqual(capability_loaded["document"], {})

        asset_saved = hosted_authoring_session.save_asset(
            self.indexed,
            authoring_token,
            expected_revision=1,
            path="assets/hero.png",
            data=PNG_1X1,
        )
        self.assertEqual(asset_saved["draft_revision"], 2)

        document_saved = hosted_authoring_session.save_document(
            self.indexed,
            authoring_token,
            expected_revision=2,
            document=novel_document("Novel Host roundtrip v1"),
        )
        self.assertEqual(document_saved["draft_revision"], 3)

        preview = hosted_authoring_preview.create_preview(
            self.indexed,
            self.bob,
            content_id,
            self.player["app_id"],
            expected_revision=3,
        )
        preview_token = preview["content_path"].split("/")[3]
        preview_index, _ = hosted_authoring_preview.get_preview_file(
            self.indexed,
            preview_token,
            "index.html",
        )
        preview_player, _ = hosted_authoring_preview.get_preview_file(
            self.indexed,
            preview_token,
            "player.js",
        )
        preview_asset, preview_asset_type = hosted_authoring_preview.get_preview_file(
            self.indexed,
            preview_token,
            "assets/hero.png",
        )
        self.assertIn(b"Novel Host roundtrip v1", preview_index)
        self.assertIn(b"minapp.userState", preview_player)
        self.assertEqual(preview_asset, PNG_1X1)
        self.assertEqual(preview_asset_type, "image/png")

        published = hosted_authoring_session.publish_project(
            self.publisher,
            authoring_token,
            expected_revision=3,
        )
        published_app_id = published["published_app_id"]
        self.assertEqual(published["player_app_id"], self.player["app_id"])
        self.assertEqual(published["player_source_version"], 1)

        normal_apps = self.publisher.list_group_apps(self.bob, self.group_id)
        work_apps = [item for item in normal_apps if item["app_id"] == published_app_id]
        self.assertEqual(len(work_apps), 1)
        self.assertEqual(work_apps[0]["source_kind"], "authoring")
        self.assertEqual(work_apps[0]["published_version"], 1)

        normal_launch = self.publisher.create_published_session(
            self.bob,
            self.group_id,
            published_app_id,
        )
        normal_token = normal_launch["content_path"].split("/")[3]
        normal_index, _ = self.publisher.get_published_file(normal_token, "index.html")
        normal_player, _ = self.publisher.get_published_file(normal_token, "player.js")
        normal_asset, normal_asset_type = self.publisher.get_published_file(
            normal_token,
            "assets/hero.png",
        )
        self.assertIn(b"Novel Host roundtrip v1", normal_index)
        self.assertIn(b"minapp.userState", normal_player)
        self.assertEqual(normal_asset, PNG_1X1)
        self.assertEqual(normal_asset_type, "image/png")

        edited = hosted_authoring_session.save_document(
            self.indexed,
            authoring_token,
            expected_revision=3,
            document=novel_document("Novel Host roundtrip v2"),
        )
        self.assertEqual(edited["draft_revision"], 4)

        second_preview = hosted_authoring_preview.create_preview(
            self.indexed,
            self.bob,
            content_id,
            self.player["app_id"],
            expected_revision=4,
        )
        second_preview_token = second_preview["content_path"].split("/")[3]
        second_preview_index, _ = hosted_authoring_preview.get_preview_file(
            self.indexed,
            second_preview_token,
            "index.html",
        )
        self.assertIn(b"Novel Host roundtrip v2", second_preview_index)
        self.assertNotIn(b"Novel Host roundtrip v1", second_preview_index)

        republished = hosted_authoring_session.publish_project(
            self.publisher,
            authoring_token,
            expected_revision=4,
        )
        self.assertEqual(republished["published_app_id"], published_app_id)
        self.assertEqual(republished["published_version"], 2)
        self.assertEqual(republished["player_app_id"], self.player["app_id"])
        self.assertEqual(republished["player_source_version"], 1)

        latest_launch = self.publisher.create_published_session(
            self.bob,
            self.group_id,
            published_app_id,
        )
        latest_token = latest_launch["content_path"].split("/")[3]
        latest_index, _ = self.publisher.get_published_file(latest_token, "index.html")
        self.assertIn(b"Novel Host roundtrip v2", latest_index)
        self.assertNotIn(b"Novel Host roundtrip v1", latest_index)


if __name__ == "__main__":
    unittest.main()

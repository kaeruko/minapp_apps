"""Offline contract tests for the Kobo deployment pipeline."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import zipfile
import io

MODULE_PATH = Path(__file__).with_name("publish.py")
spec = importlib.util.spec_from_file_location("publish_kobo", MODULE_PATH)
assert spec and spec.loader
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

GROUP = "a" * 32
APP = "b" * 32
TITLE = "晩酌予算"
MAPS_KEY = "AIza" + "A" * 35


class PublisherTests(unittest.TestCase):
    def test_registry_and_deterministic_archive(self):
        registry = publisher.parse_registry()
        self.assertIn("drink_budget", registry)
        self.assertIn("chinese_food_memo", registry)
        self.assertIn("lunch_roulette", registry)
        self.assertIn("allowance_manager", registry)
        allowance = publisher.build_zip("allowance_manager", registry["allowance_manager"]["files"])
        with zipfile.ZipFile(io.BytesIO(allowance)) as archive:
            self.assertEqual(set(archive.namelist()), set(registry["allowance_manager"]["files"]))
            self.assertNotIn("test_ledger.js", archive.namelist())
            self.assertIn("ledger.js", archive.namelist())
        self.assertEqual(allowance, publisher.build_zip("allowance_manager", registry["allowance_manager"]["files"]))
        lunch = publisher.build_zip("lunch_roulette", registry["lunch_roulette"]["files"])
        self.assertEqual(lunch, publisher.build_zip("lunch_roulette", registry["lunch_roulette"]["files"]))
        with zipfile.ZipFile(io.BytesIO(lunch)) as archive:
            self.assertEqual(set(archive.namelist()), set(registry["lunch_roulette"]["files"]))
            self.assertIn("assets/roulette_frame.png", archive.namelist())
            self.assertIn("assets/food_ramen.png", archive.namelist())
            self.assertNotIn("test_roulette.js", archive.namelist())
        content = publisher.build_zip("drink_budget", registry["drink_budget"]["files"])
        chinese = publisher.build_zip("chinese_food_memo", registry["chinese_food_memo"]["files"])
        with zipfile.ZipFile(io.BytesIO(chinese)) as archive:
            self.assertEqual(set(archive.namelist()), set(registry["chinese_food_memo"]["files"]))
            self.assertNotIn("test_memo.js", archive.namelist())
            self.assertIn(publisher.MAPS_API_KEY_PLACEHOLDER, archive.read("maps-config.js"))
        published_chinese = publisher.build_zip(
            "chinese_food_memo",
            registry["chinese_food_memo"]["files"],
            maps_api_key=MAPS_KEY,
        )
        with zipfile.ZipFile(io.BytesIO(published_chinese)) as archive:
            config = archive.read("maps-config.js")
            self.assertIn(MAPS_KEY.encode("ascii"), config)
            self.assertNotIn(publisher.MAPS_API_KEY_PLACEHOLDER, config)
        self.assertEqual(content, publisher.build_zip("drink_budget", registry["drink_budget"]["files"]))
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            self.assertEqual(set(zf.namelist()), set(registry["drink_budget"]["files"]))
            self.assertNotIn("README.md", zf.namelist())
            self.assertNotIn("test_budget.js", zf.namelist())
            self.assertIn("index.html", zf.namelist())

    def test_secrets_are_required_before_network(self):
        with self.assertRaisesRegex(ValueError, "KOBO_API_BASE_URL"):
            publisher.require_settings({})
        with self.assertRaisesRegex(ValueError, "KOBO_GROUP_ID"):
            publisher.require_settings({
                "KOBO_API_BASE_URL": "https://api.example.com",
                "KOBO_LOGIN_ID": "someone",
                "KOBO_PASSWORD": "secret",
                "KOBO_GROUP_ID": "invalid",
            })
        with self.assertRaisesRegex(ValueError, "HTTPS public origin"):
            publisher.require_origin("http://localhost:8000")
        with self.assertRaisesRegex(ValueError, "KOBO_GOOGLE_MAPS_API_KEY"):
            publisher.require_maps_api_key({})
        with self.assertRaisesRegex(ValueError, "invalid format"):
            publisher.require_maps_api_key({"KOBO_GOOGLE_MAPS_API_KEY": "not-a-key"})
        self.assertEqual(
            publisher.require_maps_api_key({"KOBO_GOOGLE_MAPS_API_KEY": MAPS_KEY}),
            MAPS_KEY,
        )

    def test_invalid_registry_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "apps.json"
            path.write_text('{"schema_version":1,"apps":{"drink_budget":{"title":"foo","files":["../index.html"],"shop_visibility":"listed"}}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                publisher.parse_registry(path)

    def test_existing_publication_is_not_republished(self):
        payload = b"archive"
        sha = hashlib.sha256(payload).hexdigest()
        client = Mock()
        client.request.side_effect = [
            {"groups": [{"group_id": GROUP, "status": "active"}]},
            {"app_id": APP, "group_id": GROUP, "title": TITLE, "editable": True,
             "source_kind": "upload", "source_revision": 3, "source_sha256": sha},
            {"app_id": APP, "group_id": GROUP, "source_revision": 3,
             "published_version": 2, "published_history": [{"version": 2, "source_revision": 3, "sha256": sha}]},
            {"apps": [{"app_id": APP, "version": "2", "sha256": sha}]},
        ]
        publisher.deploy(client, "drink_budget", {"title": TITLE, "shop_visibility": "listed"}, payload, GROUP)
        paths = [call.args[1] for call in client.request.call_args_list]
        self.assertNotIn(f"/hosted/groups/{GROUP}/apps/{APP}/publish", paths)
        self.assertNotIn(f"/apps/{APP}/shop-visibility", paths)
        self.assertEqual(len(paths), 4)

    def test_new_app_is_published_and_listed(self):
        payload = b"archive"
        sha = hashlib.sha256(payload).hexdigest()
        client = Mock()
        client.request.side_effect = [
            {"groups": [{"group_id": GROUP, "status": "active"}]},
            {"app_id": APP, "group_id": GROUP, "title": TITLE, "editable": True,
             "source_kind": "upload", "source_revision": 1, "source_sha256": sha},
            {"app_id": APP, "group_id": GROUP, "source_revision": 1,
             "published_version": None, "published_history": []},
            {"app_id": APP, "group_id": GROUP, "source_revision": 1, "published_version": 1},
            {"apps": []},
            {"app_id": APP, "shop_visibility": "listed"},
            {"apps": [{"app_id": APP, "version": "1", "sha256": sha}]},
        ]
        publisher.deploy(client, "drink_budget", {"title": TITLE, "shop_visibility": "listed"}, payload, GROUP)
        paths = [call.args[1] for call in client.request.call_args_list]
        self.assertIn(f"/hosted/groups/{GROUP}/apps/{APP}/publish", paths)
        self.assertIn(f"/apps/{APP}/shop-visibility", paths)
        self.assertEqual(len(paths), 7)

    def test_wrong_owner_scope_or_corrupt_upload_stops(self):
        client = Mock()
        client.request.side_effect = [
            {"groups": [{"group_id": GROUP, "status": "active"}]},
            {"app_id": APP, "group_id": GROUP, "title": TITLE, "editable": True,
             "source_kind": "upload", "source_revision": 1, "source_sha256": "f" * 64},
        ]
        with self.assertRaisesRegex(ValueError, "metadata does not match"):
            publisher.deploy(client, "drink_budget", {"title": TITLE, "shop_visibility": "listed"}, b"archive", GROUP)
        self.assertEqual(client.request.call_count, 2)


if __name__ == "__main__":
    unittest.main()

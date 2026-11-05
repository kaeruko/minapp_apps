"""Ensure the Kobo input form distinguishes required and optional fields."""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import unittest

HTML_FILE = Path(__file__).with_name("index.html")
REQUIRED_IDS = {"shop", "visited-at", "dish"}
OPTIONAL_IDS = {"area", "price", "rating", "note", "favorite"}


class FormGroups(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.group = None
        self.fields = {"required-fields": {}, "optional-fields": {}}
        self.titles = set()
        self.default_rating = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        identifier = attributes.get("id")
        if tag == "section" and identifier in self.fields:
            if self.group is not None or self.fields[identifier]:
                raise ValueError("Duplicate or nested form section: " + identifier)
            self.group = identifier
        if tag == "h3" and identifier in ("required-fields-title", "optional-fields-title"):
            self.titles.add(identifier)
        if tag in ("input", "select", "textarea") and self.group is not None:
            if not identifier:
                raise ValueError("A grouped field has no ID")
            if any(identifier in group for group in self.fields.values()):
                raise ValueError("Duplicate form control: " + identifier)
            self.fields[self.group][identifier] = "required" in attributes
        if self.group == "optional-fields" and tag == "option":
            if "selected" in attributes and attributes.get("value") == "3":
                self.default_rating = 3

    def handle_endtag(self, tag):
        if tag == "section" and self.group is not None:
            self.group = None


class FormLayoutTests(unittest.TestCase):
    def test_navigation_map_and_save_form_are_present(self):
        source = HTML_FILE.read_text(encoding="utf-8")
        self.assertIn('id="form-title" class="page-title"', source)
        self.assertIn('type="submit" id="save-record" class="primary"', source)
        self.assertEqual(source.count('id="record-form"'), 1)
        self.assertEqual(source.count('id="save-record"'), 1)
        self.assertEqual(source.count('class="nav-button'), 4)
        self.assertEqual(source.count('referrerpolicy="strict-origin-when-cross-origin"'), 2)
        self.assertIn('id="map-frame"', source)
        self.assertIn('id="map-frame-large"', source)
        self.assertNotIn('写真を追加', source)

    def test_required_vs_optional_controls(self):
        source = HTML_FILE.read_text(encoding="utf-8")
        parser = FormGroups()
        parser.feed(source)
        parser.close()
        self.assertEqual(set(parser.fields["required-fields"]), REQUIRED_IDS)
        self.assertEqual(set(parser.fields["optional-fields"]), OPTIONAL_IDS)
        self.assertTrue(all(parser.fields["required-fields"].values()))
        self.assertFalse(any(parser.fields["optional-fields"].values()))
        self.assertEqual(parser.titles, {"required-fields-title", "optional-fields-title"})
        self.assertEqual(parser.default_rating, 3)
        self.assertIn("空欄でもOK", source)
        self.assertIn("オプション項目", source)


if __name__ == "__main__":
    unittest.main()

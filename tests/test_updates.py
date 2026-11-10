import unittest

from ktvibes.main import newer_release, project_version, version_key


class UpdateCheckTests(unittest.TestCase):
    def test_current_version_is_0_7_0(self):
        self.assertEqual(project_version(), "0.7.0")

    def test_numeric_versions_accept_release_tag_prefix(self):
        self.assertEqual(version_key("v0.6.2"), (0, 6, 2))
        self.assertIsNone(version_key("v0.6.2-beta.1"))

    def test_newer_stable_release_is_reported(self):
        release = {
            "tag_name": "v0.7.1",
            "html_url": "https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/v0.7.1",
        }
        self.assertEqual(newer_release("0.7.0", release), {
            "version": "v0.7.1", "url": release["html_url"]
        })

    def test_same_or_older_release_is_not_reported(self):
        for tag in ("v0.7.0", "v0.6.9"):
            with self.subTest(tag=tag):
                self.assertIsNone(newer_release("0.7.0", {
                    "tag_name": tag,
                    "html_url": f"https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/{tag}",
                }))

    def test_prereleases_and_untrusted_links_are_ignored(self):
        self.assertIsNone(newer_release("0.7.0", {
            "tag_name": "v0.7.0", "prerelease": True,
            "html_url": "https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/v0.7.0",
        }))
        self.assertIsNone(newer_release("0.7.0", {
            "tag_name": "v0.7.0", "html_url": "https://example.com/",
        }))


if __name__ == "__main__":
    unittest.main()

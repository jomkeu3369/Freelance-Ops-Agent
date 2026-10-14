import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('pair', Path(__file__).with_name('verify_pair.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ExactRegistryIdentityTest(unittest.TestCase):
    def facts(self):
        return {'repo_digests': [m.OLD_IMAGES['backend']], 'image_id': 'sha256:' + '1'*64,
                'architecture': 'amd64', 'os': 'linux'}

    def test_exact_manifest_is_valid_with_different_engine_local_config_id(self):
        m.validate_image_identity('backend', m.OLD_IMAGES['backend'], self.facts())

    def test_matching_local_id_cannot_substitute_for_wrong_registry_manifest(self):
        facts = self.facts()
        facts['image_id'] = m.OLD_IMAGES['backend'].rsplit('@', 1)[1]
        facts['repo_digests'] = ['ghcr.io/jomkeu3369/freelance-ops-backend@sha256:' + '2'*64]
        with self.assertRaisesRegex(AssertionError, 'digest_matches'):
            m.validate_image_identity('backend', m.OLD_IMAGES['backend'], facts)

    def test_wrong_platform_cannot_match_actual_linux_amd64_runtime(self):
        facts = self.facts()
        facts['architecture'] = 'arm64'
        with self.assertRaisesRegex(AssertionError, 'linux_amd64'):
            m.validate_image_identity('backend', m.OLD_IMAGES['backend'], facts)

    def test_invalid_local_id_is_rejected(self):
        facts = self.facts()
        facts['image_id'] = 'unexpected'
        with self.assertRaisesRegex(AssertionError, 'local_image_id'):
            m.validate_image_identity('backend', m.OLD_IMAGES['backend'], facts)


if __name__ == '__main__':
    unittest.main()

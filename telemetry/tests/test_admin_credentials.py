import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from telemetry import rotate_metabase_admin


class AdminCredentialsTests(unittest.TestCase):
    def test_rotation_preserves_shared_env_settings_and_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / ".env"
            config.write_text("POSTHOG_PROJECT_TOKEN=phc_example\nMB_DB_PASSWORD=database-secret\n"
                              "METABASE_ADMIN_EMAIL=admin@example.com\nMETABASE_ADMIN_PASSWORD=old-secret\n")
            os.chmod(config, 0o600)
            calls = []

            def request(path, body=None, session=None, method=None):
                calls.append((path, body, method))
                if path == "/api/session":
                    return {"id": "session"}
                if path == "/api/user/current":
                    return {"is_superuser": True, "email": "admin@example.com", "id": 3}
                return None

            with patch.object(rotate_metabase_admin, "PRIVATE_FILE", config), \
                    patch.object(rotate_metabase_admin, "request", side_effect=request), \
                    patch.object(rotate_metabase_admin.secrets, "token_urlsafe", return_value="new-secret"):
                rotate_metabase_admin.rotate()

            self.assertEqual(config.read_text(), "POSTHOG_PROJECT_TOKEN=phc_example\nMB_DB_PASSWORD=database-secret\n"
                             "METABASE_ADMIN_EMAIL=admin@example.com\nMETABASE_ADMIN_PASSWORD=new-secret\n")
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertEqual(calls[2], ("/api/user/3/password", {"password": "new-secret"}, "PUT"))
            self.assertEqual(calls[-1][1]["password"], "new-secret")


if __name__ == "__main__":
    unittest.main()

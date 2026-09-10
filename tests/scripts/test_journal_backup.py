import importlib.util
import json
import tempfile
import unittest
import fcntl
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[2] / 'scripts/journal_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_waits_for_an_in_progress_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            (journal / 'day.json').write_text('{}')
            with (journal / '.lock').open('a') as lock, ThreadPoolExecutor() as pool:
                fcntl.flock(lock, fcntl.LOCK_EX)
                pending = pool.submit(backup.pack, root)
                try:
                    with self.assertRaises(TimeoutError):
                        pending.result(timeout=.1)
                    (journal / 'new-proof.txt').write_text('checkpoint evidence')
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
                output = pending.result(timeout=5)
            self.assertEqual(backup.verify(json.loads((output / 'upload.json').read_text())), 2)

    def test_round_trip_and_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            (journal / 'day.json').write_text('{"checkpoints": []}')
            (journal / 'proof.png').write_bytes(bytes(range(256)) * 1000)
            (root / '.private/backups').mkdir()
            (root / '.private/backups/excluded.txt').write_text('not a journal file')
            output = backup.pack(root)
            data = json.loads((output / 'upload.json').read_text())
            self.assertEqual(backup.verify(data), 2)
            data['chunks'][0] = 'broken' + data['chunks'][0]
            with self.assertRaises(ValueError):
                backup.verify(data)

    def test_symlink_and_empty_journal_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            with self.assertRaises(ValueError):
                backup.pack(root)
            (root / 'outside.txt').write_text('private unrelated file')
            (journal / 'linked.json').symlink_to(root / 'outside.txt')
            with self.assertRaises(ValueError):
                backup.pack(root)


if __name__ == '__main__':
    unittest.main()

import importlib.util
import json
import hashlib
import base64
import io
import zipfile
import tempfile
import subprocess
import sys
import os
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
            (journal / 'day.json').write_text('{"version": 1, "checkpoints": []}')
            with (journal / '.lock').open('a') as lock, ThreadPoolExecutor() as pool:
                fcntl.flock(lock, fcntl.LOCK_EX)
                pending = pool.submit(backup.pack, root)
                try:
                    with self.assertRaises(TimeoutError):
                        pending.result(timeout=.1)
                    evidence = b'checkpoint evidence'
                    (journal / 'new-proof.txt').write_bytes(evidence)
                    (journal / 'day.json').write_text(json.dumps({'version': 1, 'checkpoints': [
                        {'artifactSnapshots': [{'storedPath': 'new-proof.txt', 'bytes': len(evidence),
                         'sha256': hashlib.sha256(evidence).hexdigest()}]}]}))
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
                output = pending.result(timeout=5)
            self.assertEqual(backup.verify(json.loads((output / 'upload.json').read_text())), 2)

    def test_round_trip_and_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            (journal / 'day.json').write_text('{"version": 1, "checkpoints": []}')
            (journal / 'proof.png').write_bytes(bytes(range(256)) * 1000)
            (root / '.private/backups').mkdir()
            (root / '.private/backups/excluded.txt').write_text('not a journal file')
            output = backup.pack(root)
            data = json.loads((output / 'upload.json').read_text())
            self.assertEqual(backup.verify(data), 1)  # Unreferenced evidence is excluded.
            data['chunks'][0] = 'broken' + data['chunks'][0]
            with self.assertRaises(ValueError):
                backup.verify(data)

    def test_recorded_artifacts_must_be_recoverable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            content = b'original evidence'
            artifact = {'storedPath': 'artifacts/proof.txt', 'bytes': len(content),
                        'sha256': hashlib.sha256(content).hexdigest()}
            (journal / 'day.json').write_text(json.dumps({'version': 1, 'checkpoints': [
                {'artifactSnapshots': [artifact]}]}))
            with self.assertRaises(ValueError):
                backup.pack(root)
            proof = journal / artifact['storedPath']
            proof.parent.mkdir()
            proof.write_bytes(b'changed evidence')
            with self.assertRaises(ValueError):
                backup.pack(root)
            proof.write_bytes(content)
            output = backup.pack(root)
            data = json.loads((output / 'upload.json').read_text())
            self.assertEqual(backup.verify(data), 2)
            # Even an internally consistent ZIP/hash must retain referenced evidence.
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as archive:
                archive.writestr('day.json', (journal / 'day.json').read_bytes())
            archive = buffer.getvalue()
            data.update(chunks=[base64.b64encode(archive).decode()], bytes=len(archive),
                        sha256=hashlib.sha256(archive).hexdigest(), fileCount=1)
            with self.assertRaises(ValueError):
                backup.verify(data)

    def test_invalid_day_records_are_not_recoverable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            journal.mkdir(parents=True)
            for day in [{'version': 2}, {}, {'version': 1, 'checkpoints': 'invalid'}]:
                (journal / 'day.json').write_text(json.dumps(day))
                with self.assertRaises(ValueError):
                    backup.pack(root)

    def test_orphaned_artifact_is_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            journal = root / '.private/development/journal'
            (journal / 'artifacts').mkdir(parents=True)
            (journal / 'day.json').write_text('{"version": 1, "checkpoints": []}')
            (journal / 'artifacts/orphan.txt').write_text('interrupted checkpoint')
            output = backup.pack(root)
            with zipfile.ZipFile(output / 'journal.zip') as archive:
                self.assertEqual(archive.namelist(), ['day.json'])

    def test_missing_timezone_data_has_actionable_error(self):
        script = Path(__file__).resolve().parents[2] / 'scripts/development_journal.py'
        result = subprocess.run([sys.executable, '-S', str(script), 'clock'],
                                env={**os.environ, 'PYTHONTZPATH': ''}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Install system tzdata', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

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

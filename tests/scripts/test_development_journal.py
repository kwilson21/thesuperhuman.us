import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import journal_paths


SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'development_journal.py'
SPEC = importlib.util.spec_from_file_location('development_journal', SCRIPT)
journal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(journal)


class CanonicalJournalStorageTests(unittest.TestCase):
    def test_uses_the_primary_checkout_even_when_main_is_linked_elsewhere(self):
        """The primary checkout, not its current branch, owns the private journal."""
        with tempfile.TemporaryDirectory() as temporary:
            primary = Path(temporary) / 'primary'
            worktree = Path(temporary) / 'worktree'
            with patch.object(journal_paths, 'git_worktrees', return_value=[(primary, 'refs/heads/release'), (worktree, 'refs/heads/main')]):
                self.assertEqual(journal.journal_root(worktree), primary)

    def test_keeps_a_standalone_checkout_local(self):
        """A non-worktree checkout must not write outside its own project."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(journal, 'git_worktrees', return_value=[]):
                self.assertEqual(journal.journal_root(root), root)


if __name__ == '__main__':
    unittest.main()

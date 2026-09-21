"""Resolve the one private journal location shared by linked Git worktrees."""
import subprocess
from pathlib import Path


def git_worktrees(root):
    try:
        result = subprocess.run(
            ['git', '-C', str(root), 'worktree', 'list', '--porcelain'],
            check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError):
        return []
    worktrees = []
    current = {}
    for line in result.stdout.splitlines() + ['']:
        if not line:
            if current.get('worktree'):
                worktrees.append((Path(current['worktree']).resolve(), current.get('branch')))
            current = {}
        elif line.startswith('worktree '):
            current['worktree'] = line.removeprefix('worktree ')
        elif line.startswith('branch '):
            current['branch'] = line.removeprefix('branch ')
    return worktrees


def journal_root(invoking_root):
    """Git lists the primary checkout first, regardless of its checked-out branch."""
    worktrees = git_worktrees(invoking_root)
    return worktrees[0][0] if worktrees else invoking_root

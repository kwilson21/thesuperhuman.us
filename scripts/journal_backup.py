#!/usr/bin/env python3
"""Prepare and verify private journal recovery archives. No network or credentials."""
import argparse
import base64
import hashlib
import io
import json
import fcntl
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify(data):
    try:
        archive = base64.b64decode(''.join(data['chunks']), validate=True)
        if len(archive) != data['bytes'] or hashlib.sha256(archive).hexdigest() != data['sha256']:
            raise ValueError('Backup hash or size mismatch.')
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            if zipped.testzip() is not None or len(zipped.infolist()) != data['fileCount']:
                raise ValueError('Backup archive is incomplete.')
            for name in zipped.namelist():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise ValueError('Unsafe archive path.')
        return data['fileCount']
    except (KeyError, zipfile.BadZipFile, OSError, TypeError) as error:
        raise ValueError('Invalid backup.') from error


def pack(root):
    root = root.resolve()
    journal = root / '.private/development/journal'
    if not journal.is_dir() or not journal.resolve().is_relative_to(root):
        raise ValueError('No local private journal.')
    with (journal / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        files = sorted(p for p in journal.rglob('*') if p.name != '.lock')
        if any(p.is_symlink() for p in files):
            raise ValueError('Journal backup refuses symlinks.')
        files = [p for p in files if p.is_file()]
        if not files or not list(journal.glob('*.json')):
            raise ValueError('No checkpoints to back up.')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zipped:
            for path in files:
                zipped.write(path, str(path.relative_to(journal)))
        archive = buffer.getvalue()
    digest = hashlib.sha256(archive).hexdigest()
    encoded = base64.b64encode(archive).decode('ascii')
    data = {'id': digest, 'createdAt': datetime.now(timezone.utc).isoformat(),
            'sha256': digest, 'bytes': len(archive), 'fileCount': len(files),
            'chunks': [encoded[i:i + 32768] for i in range(0, len(encoded), 32768)]}
    verify(data)
    output = root / '.private/backups' / digest
    if not output.resolve().is_relative_to(root):
        raise ValueError('Backup directory must stay inside project.')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    (output / 'journal.zip').write_bytes(archive)
    (output / 'upload.json').write_text(json.dumps(data))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['pack', 'verify'])
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--file', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'pack':
            print(pack(args.root))
        elif args.file:
            print(json.dumps({'verifiedFiles': verify(json.loads(args.file.read_text()))}))
        else:
            parser.error('verify requires --file')
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')

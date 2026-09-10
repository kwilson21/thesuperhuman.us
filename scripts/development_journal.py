#!/usr/bin/env python3
"""Private development checkpoints. No transcript collection or network delivery."""
import argparse
import hashlib
import fcntl
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / '.private' / 'development' / 'journal'
ZONE = ZoneInfo('America/New_York')
FIELDS = {'id', 'title', 'summary', 'decisions', 'current', 'next', 'evidence', 'verification'}


def clock(now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('An aware clock is required.')
    local = now.astimezone(ZONE)
    return {'day': local.date().isoformat(), 'local': local.isoformat(timespec='seconds'),
            'utc': now.astimezone(timezone.utc).isoformat(timespec='seconds'), 'timezone': str(ZONE)}


def records(directory):
    result = []
    for path in sorted(directory.glob('*.json')):
        data = json.loads(path.read_text())
        if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('checkpoints'), list):
            raise ValueError(f'Invalid journal: {path.name}. Preserve it and recover before writing.')
        result.extend(data['checkpoints'])
    return result


def validate(payload):
    if not isinstance(payload, dict) or not FIELDS <= set(payload) or set(payload) - FIELDS - {'context'}:
        raise ValueError('Checkpoint fields must be: ' + ', '.join(sorted(FIELDS)))
    if not isinstance(payload['id'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,100}', payload['id']):
        raise ValueError('Use a stable lowercase checkpoint ID.')
    for field in FIELDS - {'decisions', 'evidence', 'verification'}:
        if not isinstance(payload[field], str) or not payload[field].strip():
            raise ValueError(f'{field} must be nonempty text.')
    if 'context' in payload:
        validate_context(payload['context'])
    for field in ('decisions', 'evidence', 'verification'):
        if not isinstance(payload[field], list) or any(not isinstance(x, str) or not x.strip() for x in payload[field]):
            raise ValueError(f'{field} must be a list of nonempty strings.')


def checkpoint(directory, payload, now=None, project_root=ROOT, capture_runtime=False):
    validate(payload)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for saved in records(directory):
            if saved['id'] == payload['id']:
                if {key: saved[key] for key in FIELDS | {'context'} if key in saved} != payload:
                    raise ValueError('That ID already has different content. Append an explicit correction with a new ID.')
                write_view(directory, saved['recordedAt'][:10])
                write_index(directory)
                return saved
        stamp = clock(now)
        path = directory / (stamp['day'] + '.json')
        data = json.loads(path.read_text()) if path.exists() else {
            'version': 1, 'day': stamp['day'], 'timezone': str(ZONE), 'checkpoints': []}
        entry = {**payload, 'recordedAt': stamp['local'], 'recordedAtUTC': stamp['utc']}
        if capture_runtime:
            entry['automaticContext'] = runtime_context(project_root)
        if payload.get('context', {}).get('artifacts'):
            entry['artifactSnapshots'] = preserve_artifacts(directory, payload, project_root)
        data['checkpoints'].append(entry)
        fd, temporary = tempfile.mkstemp(prefix='.checkpoint-', dir=directory)
        try:
            with os.fdopen(fd, 'w') as output:
                json.dump(data, output, ensure_ascii=False, indent=2)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        write_view(directory, stamp['day'])
        write_index(directory)
        return entry



def runtime_context(project_root):
    path = project_root / 'docs/journal-context.json'
    defaults = json.loads(path.read_text()) if path.exists() else {
        'series': None, 'season': None, 'themes': []}
    if not isinstance(defaults, dict) or set(defaults) != {'series', 'season', 'themes'}:
        raise ValueError('Invalid docs/journal-context.json; preserve it and correct the configuration.')
    context = {**defaults, 'conversations': [], 'artifacts': []}
    identity = os.environ.get('CODEX_THREAD_ID')
    if identity and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,180}', identity):
        context['conversations'].append({'provider': 'codex', 'id': identity})
    validate_context(context)
    return context


def validate_context(context):
    required = {'series', 'season', 'themes', 'conversations', 'artifacts'}
    if not isinstance(context, dict) or set(context) != required:
        raise ValueError('Context requires series, season, themes, conversations and artifacts.')
    def text(value):
        return isinstance(value, str) and bool(value.strip()) and len(value) <= 1000 and not any(ord(c) < 32 for c in value)
    if not all(context[key] is None or text(context[key]) for key in ('series', 'season')) or (context['season'] is not None and context['series'] is None):
        raise ValueError('Series/season must be null or nonempty labels; a season needs a series.')
    if not isinstance(context['themes'], list) or not all(text(v) for v in context['themes']):
        raise ValueError('Themes must be a list of descriptive labels; an empty list is allowed.')
    for kind in ('conversations', 'artifacts'):
        if not isinstance(context[kind], list):
            raise ValueError(f'{kind} must be a list.')
        seen = set()
        for item in context[kind]:
            required = {'provider', 'id'} if kind == 'conversations' else {'id', 'path', 'kind', 'caption'}
            optional = {'title', 'url'} if kind == 'conversations' else set()
            if not isinstance(item, dict) or not required <= set(item) or set(item) - required - optional or not all(text(v) for v in item.values()):
                raise ValueError(f'Invalid {kind} reference.')
            identity = (item.get('provider'), item['id'])
            if identity in seen:
                raise ValueError(f'Duplicate {kind} identity.')
            seen.add(identity)
            if 'url' in item:
                url = urlparse(item['url'])
                if url.scheme != 'https' or not url.netloc or url.username or url.password:
                    raise ValueError('Conversation links must be HTTPS, without credentials.')
            if kind == 'artifacts' and (Path(item['path']).is_absolute() or '..' in Path(item['path']).parts):
                raise ValueError('Artifact paths must stay inside the project.')


def atomic_text(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.view-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def preserve_artifacts(directory, payload, project_root):
    # Copy only explicitly nominated files. Never scan chats or whole workspaces.
    root = project_root.resolve()
    prepared = []
    for artifact in payload['context']['artifacts']:
        source = (root / artifact['path']).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError('Artifact must be an existing file inside the project.')
        if source.stat().st_size > 50 * 1024 * 1024:
            raise ValueError('Artifact exceeds the 50 MiB per-file checkpoint limit.')
        content = source.read_bytes()
        stored = Path('artifacts') / payload['id'] / artifact['path']
        destination = directory / stored
        if not destination.resolve().is_relative_to(directory.resolve()):
            raise ValueError('Artifact destination escapes the private journal.')
        if destination.exists() and destination.read_bytes() != content:
            raise ValueError('An incomplete artifact snapshot differs. Use a new checkpoint ID.')
        prepared.append((artifact, content, stored, destination))
    snapshots = []
    for artifact, content, stored, destination in prepared:
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not destination.exists():
            fd, temporary = tempfile.mkstemp(prefix='.artifact-', dir=destination.parent)
            try:
                with os.fdopen(fd, 'wb') as output:
                    output.write(content)
                os.replace(temporary, destination)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        snapshots.append({**artifact, 'storedPath': str(stored), 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
    return snapshots


def project_index(directory=JOURNAL):
    result = {'version': 1, 'timezone': str(ZONE), 'days': {}, 'series': {}, 'seasons': {},
              'themes': {}, 'conversations': {}, 'artifacts': [], 'unclassified': []}
    for entry in records(directory):
        identity, day = entry['id'], entry['recordedAt'][:10]
        result['days'].setdefault(day, []).append(identity)
        context = entry.get('context') or entry.get('automaticContext')
        if context:
            if context['series']:
                result['series'].setdefault(context['series'], []).append(identity)
                if context['season']:
                    result['seasons'].setdefault(context['series'], {}).setdefault(context['season'], []).append(identity)
            if not context['series'] or not context['season']:
                result['unclassified'].append(identity)
            for theme in dict.fromkeys(context['themes']):
                result['themes'].setdefault(theme, []).append(identity)
            chats = context['conversations'] + entry.get('automaticContext', {}).get('conversations', [])
            for chat in {json.dumps([c['provider'], c['id']]): c for c in reversed(chats)}.values():
                key = json.dumps([chat['provider'], chat['id']], ensure_ascii=False)
                # JSON tuple keys keep provider/ID boundaries unambiguous.
                link = result['conversations'].setdefault(key, {'provider': chat['provider'], 'id': chat['id'], 'days': [], 'checkpoints': [], 'titles': [], 'urls': []})
                if day not in link['days']:
                    link['days'].append(day)
                link['checkpoints'].append(identity)
                for singular, plural in [('title', 'titles'), ('url', 'urls')]:
                    if chat.get(singular) and chat[singular] not in link[plural]:
                        link[plural].append(chat[singular])
        else:
            result['unclassified'].append(identity)
        result['artifacts'].extend({**artifact, 'checkpoint': identity, 'day': day} for artifact in entry.get('artifactSnapshots', []))
    return result


def write_index(directory):
    index = project_index(directory)
    atomic_text(directory / 'index/index.json', json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Private project journal index', '', 'Days are recording dates. Working themes, seasons and series are editorial labels, not curriculum or proof of completion.', '']
    def safe(value):
        return str(value).replace('\n', ' ').replace('[', '\\[').replace(']', '\\]')
    by_id = {entry['id']: entry for entry in records(directory)}
    for day, identities in index['days'].items():
        lines.extend([f'## [{day}](../{day}.md)', ''])
        for identity in identities:
            entry = by_id[identity]
            context = entry.get('context') or entry.get('automaticContext', {})
            label = ' / '.join(value for value in (context.get('series'), context.get('season')) if value) or 'Not yet grouped'
            lines.append(f"- {entry['recordedAt'][11:19]} · {safe(entry['title'])} · {safe(label)}")
        lines.append('')
    lines.extend(['## Working series and seasons', ''])
    for series, members in index['series'].items():
        lines.extend([f'### {safe(series)}', ''])
        seasons = dict(index['seasons'].get(series, {}))
        assigned = {identity for identities in seasons.values() for identity in identities}
        pending = [identity for identity in members if identity not in assigned]
        if pending:
            seasons['Season not yet inferred'] = pending
        for season, identities in seasons.items():
            lines.append(f'- {safe(season)}')
            for identity in identities:
                entry = by_id[identity]
                day = entry['recordedAt'][:10]
                lines.append(f"  - [{day}](../{day}.md) · {safe(entry['title'])}")
    lines.extend(['', '## Themes', ''])
    for theme, identities in index['themes'].items():
        lines.append(f'### {safe(theme)}')
        for identity in identities:
            entry = by_id[identity]
            day = entry['recordedAt'][:10]
            lines.append(f"- [{day}](../{day}.md) · {safe(entry['title'])}")
        lines.append('')
    lines.extend(['## Conversations', ''])
    for chat in index['conversations'].values():
        lines.append(f"- {safe(chat['provider'])} · {safe(chat['titles'][-1] if chat['titles'] else chat['id'])} · days: {', '.join(chat['days'])}")
        lines.append(f"  - ID: {safe(chat['id'])}")
        for url in chat['urls']:
            lines.append(f'  - <{url}>')
    lines.extend(['', '## Preserved artifacts', ''])
    for artifact in index['artifacts']:
        from urllib.parse import quote
        lines.append(f"- [{safe(artifact['caption'])}](../{quote(artifact['storedPath'])}) · {safe(artifact['kind'])} · {artifact['day']} · SHA-256 `{artifact['sha256']}`")
    atomic_text(directory / 'index/index.md', '\n'.join(lines) + '\n')


def status(directory=JOURNAL):
    saved = records(directory)
    return {'clock': clock(), 'latest': saved[-1] if saved else None,
            'indexPath': str(directory / 'index/index.md'),
            'journalDirectory': str(directory.relative_to(ROOT)) if directory.is_relative_to(ROOT) else str(directory)}


def readable(directory=JOURNAL, selected_day=None):
    """A read-only Markdown view; JSON checkpoints remain authoritative."""
    lines = []
    previous_day = None
    for entry in records(directory):
        day = entry['recordedAt'][:10]
        if selected_day and day != selected_day:
            continue
        if day != previous_day:
            lines.extend([f"# {day} · Development journal", '', f"Timezone: {ZONE}", ''])
            previous_day = day
        lines.extend([f"## {entry['recordedAt'][11:19]} · {entry['title']}", '', entry['summary'], ''])
        if entry.get('context') or entry.get('automaticContext'):
            context = entry.get('context') or entry['automaticContext']
            group = ' / '.join(value for value in (context['series'], context['season']) if value) or 'Not yet grouped'
            lines.extend([f"**Working group:** {group}", '', f"**Themes:** {', '.join(context['themes']) or 'Not yet assigned'}", ''])
        for field in ('decisions', 'verification', 'evidence'):
            if entry[field]:
                lines.extend([f"### {field.title()}", ''])
                lines.extend('- ' + item for item in entry[field])
                lines.append('')
        lines.extend([f"**Current:** {entry['current']}", '', f"**Next:** {entry['next']}", ''])
    return '\n'.join(lines) or 'No development checkpoints recorded yet.\n'


def write_view(directory, day):
    """Rebuild a human-readable daily view while the checkpoint lock is held."""
    fd, temporary = tempfile.mkstemp(prefix='.journal-view-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(readable(directory, day))
        os.replace(temporary, directory / (day + '.md'))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status', 'clock', 'checkpoint', 'read', 'index'])
    parser.add_argument('--root', type=Path, default=ROOT, help='Project root; private storage stays inside this project.')
    args = parser.parse_args()
    directory = args.root.resolve() / '.private/development/journal'
    try:
        if args.command == 'read':
            print(readable(directory))
            return 0
        if args.command == 'checkpoint':
            result = checkpoint(directory, json.load(sys.stdin), project_root=args.root.resolve(), capture_runtime=True)
        elif args.command == 'index':
            result = project_index(directory)
        else:
            result = clock() if args.command == 'clock' else status(directory)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'Journal unavailable: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

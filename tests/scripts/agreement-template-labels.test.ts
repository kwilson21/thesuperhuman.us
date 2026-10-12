import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const migrationsBefore = (name: string) => readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(file => file.endsWith('.sql') && file < name).sort();
const migrationSql = (name: string) => readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url), 'utf8');
const sha = 'a'.repeat(64);

function insertTemplate(db: InstanceType<typeof DatabaseSync>, id: string, kind: string, version: number, label: string | null) {
  db.prepare("INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label) VALUES (?,?,?,'Synthetic template',?,'now','owner',?)").run(id, kind, version, sha, label);
}

describe('agreement template version labels', () => {
  it('keeps db/music.sql identical to the ordered music migrations', () => {
    const migrations = readdirSync(new URL('../../migrations/music/', import.meta.url)).filter(file => file.endsWith('.sql')).sort();
    const concatenated = Buffer.concat(migrations.map(name => readFileSync(new URL(`../../migrations/music/${name}`, import.meta.url))));
    expect(readFileSync(new URL('../../db/music.sql', import.meta.url))).toEqual(concatenated);
  });

  it('adds the label and revision columns and a per-kind unique label index on a fresh database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
    const columns = db.prepare("SELECT name FROM pragma_table_info('software_agreement_templates')").all().map((row: { name: string }) => row.name);
    expect(columns).toEqual(expect.arrayContaining(['version_label', 'source_revision']));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='software_agreement_templates_label'").get()).toEqual({ name: 'software_agreement_templates_label' });
    db.close();
  });

  it('rejects a duplicate label within one kind and allows the same label across kinds', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
    insertTemplate(db, 'msa-1', 'msa', 1, 'v2026-09-30');
    expect(() => insertTemplate(db, 'msa-2', 'msa', 2, 'v2026-09-30')).toThrow(/UNIQUE constraint failed/);
    expect(() => insertTemplate(db, 'sow-1', 'sow', 1, 'v2026-09-30')).not.toThrow();
    db.close();
  });

  it('allows several unlabeled templates of one kind', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
    insertTemplate(db, 'msa-1', 'msa', 1, null);
    insertTemplate(db, 'msa-2', 'msa', 2, null);
    expect(db.prepare("SELECT COUNT(*) AS total FROM software_agreement_templates WHERE kind='msa' AND version_label IS NULL").get()).toEqual({ total: 2 });
    db.close();
  });

  it('keeps templates immutable so a label can only be set at insert', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('../../db/music.sql', import.meta.url), 'utf8'));
    insertTemplate(db, 'msa-1', 'msa', 1, 'v2026-09-30');
    expect(() => db.exec("UPDATE software_agreement_templates SET version_label='x'")).toThrow(/Immutable template/);
    db.close();
  });

  it('upgrades a database with an existing template row and reads NULL label and revision', () => {
    const db = new DatabaseSync(':memory:');
    for (const name of migrationsBefore('0026_agreement_template_labels.sql')) db.exec(migrationSql(name));
    db.exec(`INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES ('legacy','msa',1,'Synthetic template','${sha}','2026-09-01','owner')`);
    db.exec(migrationSql('0026_agreement_template_labels.sql'));
    expect(db.prepare('SELECT id,kind,version,text,published_at,version_label,source_revision FROM software_agreement_templates').all()).toEqual([
      { id: 'legacy', kind: 'msa', version: 1, text: 'Synthetic template', published_at: '2026-09-01', version_label: null, source_revision: null },
    ]);
    db.close();
  });
});

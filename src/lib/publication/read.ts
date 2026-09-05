import { parsePublication, type Story } from './contract';

export interface PublicEntry {
  entryId: string;
  occurredOn: string;
  publishedAt: string;
  backfilled: boolean;
  story: Story;
}
export interface ProjectFeed {
  projectId: string;
  revision: number;
  current: PublicEntry | null;
  history: PublicEntry[];
}

function entry(row: Record<string, unknown>): PublicEntry | null {
  if (row.payload === null) return null;
  const p = parsePublication(JSON.parse(row.payload as string));
  if (!p || !p.story) throw new Error('Invalid stored publication');
  return { entryId: p.entryId, occurredOn: p.occurredOn,
    publishedAt: row.published_at as string, backfilled: row.origin === 'backfill', story: p.story };
}

/** One snapshot; bounded history. Public callers must enforce their project allowlist. */
export async function readProject(db: D1Database, projectId: string): Promise<ProjectFeed> {
  const [version, current, history] = await db.batch([
    db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM publication_events WHERE project_id=?1').bind(projectId),
    db.prepare(`SELECT payload,published_at,origin FROM publication_events
      WHERE project_id=?1 AND origin!='backfill' AND entry_id=(
        SELECT entry_id FROM publication_events WHERE project_id=?1
          AND operation='publish' AND origin!='backfill' ORDER BY revision DESC LIMIT 1)
      ORDER BY revision DESC LIMIT 1`).bind(projectId),
    db.prepare(`SELECT e.payload,e.published_at,e.origin FROM publication_events e
      WHERE e.project_id=?1 AND e.payload IS NOT NULL AND e.operation!='withdraw'
        AND e.revision=(SELECT MAX(revision) FROM publication_events
          WHERE project_id=e.project_id AND entry_id=e.entry_id)
      ORDER BY json_extract(e.payload,'$.occurredOn') DESC,e.revision DESC LIMIT 100`).bind(projectId),
  ]);
  return { projectId, revision: version.results[0].revision as number,
    current: current.results.length ? entry(current.results[0]) : null,
    history: history.results.map(entry).filter((e): e is PublicEntry => e !== null) };
}

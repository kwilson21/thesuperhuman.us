import { newYorkTime } from './agreement-artifacts';
import { softwareDate } from './software-projects';
import { agreementEvent } from './agreement-events';
import { hashOfferToken } from './software-offers';
import { templateFields } from './agreement-template-fields.mjs';
import coverage from '../assets/agreement-fonts/Inter-coverage.json';
import { lineDiff } from './line-diff';
export { templateFields } from './agreement-template-fields.mjs';
const optionalFields = [
  'contractor.legal_name',
  'contractor.entity_jurisdiction',
  'contractor.notice_email',
  'contractor.business_address',
  'contractor.config_version',
  'sow.summary',
  'sow.timing',
  'contractor.signer_name',
  'contractor.signer_title',
];
export type AgreementKind = keyof typeof templateFields;
const bytes = (s: string) => new TextEncoder().encode(s).length;
export function sampleAgreementValues(kind: AgreementKind, text: string, versionLabel = 'Sample version label') {
  const values: Record<string, Record<string, string> | unknown> = {};
  const addSample = (field: string) => {
    const [namespace, key] = field.split('.');
    values[namespace] ??= {};
    const group = values[namespace] as Record<string, string>;
    group[key] ??= `Sample ${key.replaceAll('_', ' ')}`;
  };
  for (const field of templateFields[kind]) addSample(field);
  for (const match of text.matchAll(/{{([a-z_]+\.[a-z_0-9]+)}}/g)) addSample(match[1]);
  if (kind === 'sow') values.milestones = [values.milestone];
  // Previews show the label the owner typed, as clients will see it.
  const msa = (values.msa ??= {}) as Record<string, string>;
  msa.version_label = versionLabel;
  return values;
}
export const agreementCharacterSupported = (character: string) =>
  ['\n', '\r', '\t'].includes(character) ||
  coverage.ranges.some(
    ([start, end]) => character.codePointAt(0)! >= start && character.codePointAt(0)! <= end,
  );
export function agreementCertificateText(json: string) {
  // Format certificate display only. Stored evidence and its canonical hash stay exact.
  const display = JSON.stringify(JSON.parse(json), (key, value) =>
    typeof value === 'string' && /(?:_at|_on|date)$/.test(key) && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)
      ? value.length === 10 ? softwareDate(value) : newYorkTime(value)
      : value,
  );
  return [...display]
    .map((character) =>
      agreementCharacterSupported(character)
        ? character
        : character
            .split('')
            .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
            .join(''),
    )
    .join('');
}
export function validateAgreementCharacters(text: string) {
  for (const character of text) {
    if (!agreementCharacterSupported(character))
      throw new Error('Unsupported character. Arrange outside-site signing.');
  }
}
export function validateTemplate(kind: AgreementKind, text: string) {
  validateAgreementCharacters(text);
  if (
    bytes(text) > 102400 ||
    !text.trim() ||
    /[<>]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cs}/u.test(text)
  )
    throw new Error('Use plain text up to 100 KiB, without HTML or control characters.');
  if (/\[[^\]\n]+\]|_{3,}/.test(text)) throw new Error('Replace every blank with a named field.');
  const tokens = [...text.matchAll(/{{([^{}]+)}}/g)];
  if (text.replace(/{{[^{}]+}}/g, '').match(/[{}]/)) throw new Error('Malformed field.');
  let loop = false,
    loops = 0;
  const found = new Set<string>();
  for (const t of tokens) {
    const field = t[1],
      line = text.slice(0, t.index).split('\n').length;
    if (field === '#milestones') {
      if (kind !== 'sow' || loop || loops++)
        throw new Error(`Line ${line}: only one non-nested milestone loop is allowed.`);
      loop = true;
      continue;
    }
    if (field === '/milestones') {
      if (!loop) throw new Error(`Line ${line}: unexpected loop end.`);
      loop = false;
      continue;
    }
    if (
      (!(templateFields[kind] as readonly string[]).includes(field) &&
        !optionalFields.includes(field)) ||
      (field.startsWith('milestone.') && !loop)
    )
      throw new Error(`Line ${line}: unknown field ${field}. Use the field reference.`);
    found.add(field);
  }
  if (loop) throw new Error('Close the milestone loop.');
  const missing = templateFields[kind].filter((f) => !found.has(f));
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(', ')}.`);
  return text.replace(/\r\n?/g, '\n');
}
function lookup(values: Record<string, unknown>, path: string): string {
  // {{msa.source_revision}} prints the MSA's client-visible label; the internal revision stays in the signing record.
  const key = path === 'msa.source_revision' ? 'msa.version_label' : path;
  let value: unknown = values;
  for (const part of key.split('.'))
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[part]
        : undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing value: ${key}.`);
  return value.normalize('NFC');
}
export function renderAgreement(
  kind: AgreementKind,
  template: string,
  values: Record<string, unknown>,
): string {
  validateTemplate(kind, template);
  const fill = (t: string, v: Record<string, unknown>) =>
    t.replace(/{{([a-z_]+\.[a-z_0-9]+)}}/g, (_, p) => lookup(v, p));
  const rendered = template.replace(
    /{{#milestones}}([\s\S]*?){{\/milestones}}|{{([a-z_]+\.[a-z_0-9]+)}}/g,
    (_, block, path) => {
      if (path) return lookup(values, path);
      const milestones = values.milestones;
      if (!Array.isArray(milestones) || milestones.length < 1 || milestones.length > 3)
        throw new Error('Use one to three milestones.');
      return milestones.map((m) => fill(block, { ...values, milestone: m })).join('\n');
    },
  );
  const text =
    rendered
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n')
      .trimEnd() + '\n';
  if (bytes(text) > 262144 || /{{|}}|\[[^\]\n]+\]|_{3,}/.test(text))
    throw new Error('The filled agreement has unresolved blanks or exceeds 256 KiB.');
  validateAgreementCharacters(text);
  return text;
}
export type AgreementTemplate = {
  id: string;
  kind: AgreementKind;
  version: number;
  text: string;
  sha256: string;
  version_label: string | null;
  source_revision: string | null;
  published_at: string;
};
export const versionLabelPattern = /^[A-Za-z0-9.-]{1,40}$/;
export const templateVersionLabel = (t: { version_label?: string | null; published_at: string }) =>
  t.version_label || `v${t.published_at.slice(0, 10)}`;
export async function currentTemplate(db: D1Database, kind: AgreementKind) {
  return db
    .prepare(
      'SELECT * FROM software_agreement_templates WHERE kind=? ORDER BY version DESC LIMIT 1',
    )
    .bind(kind)
    .first<AgreementTemplate>();
}
export async function templateVersion(db: D1Database, kind: AgreementKind, version: number) {
  return db
    .prepare('SELECT * FROM software_agreement_templates WHERE kind=? AND version=?')
    .bind(kind, version)
    .first<AgreementTemplate>();
}
export const templateComparison = (previous: AgreementTemplate, text: string) => ({
  label: templateVersionLabel(previous),
  rows: lineDiff(previous.text, text),
});
export async function compareWithPrevious(db: D1Database, template: AgreementTemplate) {
  const previous = await templateVersion(db, template.kind, template.version - 1);
  return previous ? templateComparison(previous, template.text) : null;
}
export async function publishTemplate(
  db: D1Database,
  kind: AgreementKind,
  text: string,
  expected: number,
  actor: string,
  label: { versionLabel: string; sourceRevision?: string | null },
) {
  const canonical = validateTemplate(kind, text),
    versionLabel = label.versionLabel,
    sourceRevision = label.sourceRevision?.trim() || null,
    id = crypto.randomUUID(),
    sha = await hashOfferToken(canonical),
    at = new Date().toISOString(),
    labelUsed = `${versionLabel} is already used for the ${kind.toUpperCase()}. Choose another label.`;
  if (!versionLabelPattern.test(versionLabel))
    throw new Error(
      'Use letters, digits, dots and dashes for the version label, up to 40 characters.',
    );
  const current = await currentTemplate(db, kind);
  if (current?.sha256 === sha)
    throw new Error(`This text matches ${templateVersionLabel(current)}. Nothing to publish.`);
  if (
    await db
      .prepare(
        'SELECT 1 FROM software_agreement_templates WHERE kind=? AND version_label=? LIMIT 1',
      )
      .bind(kind, versionLabel)
      .first()
  )
    throw new Error(labelUsed);
  try {
    await db.batch([
      db
        .prepare(
          `SELECT CASE WHEN COALESCE((SELECT max(version) FROM software_agreement_templates WHERE kind=?),0)=? THEN 1 ELSE json_extract('Template changed','$') END`,
        )
        .bind(kind, expected),
      db
        .prepare(
          'INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by,version_label,source_revision) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(id, kind, expected + 1, canonical, sha, at, actor, versionLabel, sourceRevision),
      agreementEvent(db, 'template-published', actor, at),
    ]);
  } catch (error) {
    // A concurrent publish can take the label between the check above and this insert.
    if (error instanceof Error && /UNIQUE constraint failed.*version_label/.test(error.message))
      throw new Error(labelUsed);
    throw error;
  }
  return { id, sha256: sha, version: expected + 1, versionLabel };
}

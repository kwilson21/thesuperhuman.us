import { agreementEvent } from './agreement-events';
import { hashOfferToken } from './software-offers';
import { templateFields } from './agreement-template-fields.mjs';
import coverage from '../assets/agreement-fonts/Inter-coverage.json';
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
export const agreementCharacterSupported = (character: string) =>
  ['\n', '\r', '\t'].includes(character) ||
  coverage.ranges.some(
    ([start, end]) => character.codePointAt(0)! >= start && character.codePointAt(0)! <= end,
  );
export function agreementCertificateText(json: string) {
  return [...json]
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
  let value: unknown = values;
  for (const part of path.split('.'))
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[part]
        : undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing value: ${path}.`);
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
};
export async function currentTemplate(db: D1Database, kind: AgreementKind) {
  return db
    .prepare(
      'SELECT * FROM software_agreement_templates WHERE kind=? ORDER BY version DESC LIMIT 1',
    )
    .bind(kind)
    .first<AgreementTemplate>();
}
export async function publishTemplate(
  db: D1Database,
  kind: AgreementKind,
  text: string,
  expected: number,
  actor: string,
) {
  const canonical = validateTemplate(kind, text),
    id = crypto.randomUUID(),
    sha = await hashOfferToken(canonical),
    at = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `SELECT CASE WHEN COALESCE((SELECT max(version) FROM software_agreement_templates WHERE kind=?),0)=? THEN 1 ELSE json_extract('Template changed','$') END`,
      )
      .bind(kind, expected),
    db
      .prepare(
        'INSERT INTO software_agreement_templates(id,kind,version,text,sha256,published_at,published_by) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(id, kind, expected + 1, canonical, sha, at, actor),
    agreementEvent(db, 'template-published', actor, at),
  ]);
  return { id, sha256: sha, version: expected + 1 };
}

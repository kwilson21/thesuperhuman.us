export const versionLabelPattern = /^[A-Za-z0-9.-]{1,40}$/;
export const templateVersionLabel = (t: { version_label?: string | null; published_at: string }) =>
  t.version_label || `v${t.published_at.slice(0, 10)}`;

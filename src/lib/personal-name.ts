export type PersonalNameVariant = 'first' | 'full';
export interface PersonalNameSegment {
  text: string;
  variant: PersonalNameVariant | null;
}

export function personalName(variant: PersonalNameVariant): string {
  return variant === 'full' ? 'Kazon Wilson' : 'Kazon';
}

export function personalNameSegments(text: string): PersonalNameSegment[] {
  return text
    .split(/(\bKazon Wilson\b|\bKazon\b)/g)
    .filter(Boolean)
    .map(part => ({
      text: part,
      variant: part === 'Kazon Wilson' ? 'full' : part === 'Kazon' ? 'first' : null,
    }));
}

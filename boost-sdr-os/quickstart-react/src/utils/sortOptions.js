// Alphabetical ordering for dropdown options (case-insensitive, numbers in natural order).
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export const sortAlpha = (items, getLabel = x => x) =>
  [...(items ?? [])].sort((a, b) => collator.compare(String(getLabel(a) ?? ''), String(getLabel(b) ?? '')));

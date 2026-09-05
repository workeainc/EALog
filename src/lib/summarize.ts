/** Lightweight, private note summarizer for the client.
 * It selects the two most informative sentences without sending work details anywhere.
 */
export function summarizeNote(input: string): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= 140) return cleaned;
  const action = /completed|built|fixed|implemented|reviewed|tested|deployed|designed|integrated|updated|resolved|created|configured|documented|improved|finished/i;
  // Long notes are often one sentence separated by commas and conjunctions.
  const clauses = cleaned.split(/,\s*|;\s*|\s+and\s+/i).map((part) => part.replace(/^(then|also|and)\s+/i, '').trim()).filter(Boolean);
  const scored = clauses.map((clause, index) => ({ clause, index, score: (action.test(clause) ? 4 : 0) + Math.min(clause.length / 80, 1) }));
  const selected = scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).sort((a, b) => a.index - b.index).map(({ clause }) => clause);
  let result = selected.join('; ');
  if (!result || result === cleaned) result = cleaned;
  if (result.length > 190) result = `${result.slice(0, 187).replace(/[\s,;:]+$/, '')}…`;
  return result;
}

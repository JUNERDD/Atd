import type { Completion } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { matchFields, rankByQuery, type MatchRange } from '@ai/ui/lib/fuzzy-match';

/*
 * The `{{` completion query. The completion source ranks the variables with it and the
 * completion list marks where they matched, so both read the same query and match the same
 * text: the label the list shows (`{{name}}`). A query holds only name characters, so the
 * braces never match.
 */

/** `{{` and the variable name typed so far, ending at the cursor. */
const TYPED_VARIABLE = /\{\{[\w.]*$/;

/** The variable reference typed before `pos`: where its `{{` starts and the name after it. */
export function typedVariable(
  state: EditorState,
  pos: number,
): { from: number; query: string } | null {
  const line = state.doc.lineAt(pos);
  const typed = TYPED_VARIABLE.exec(line.text.slice(0, pos - line.from))?.[0];
  return typed === undefined ? null : { from: pos - typed.length, query: typed.slice(2) };
}

function labelField(completion: Completion) {
  return { label: completion.label };
}

/** The completions matching `query`, best first; a blank query keeps all of them in order. */
export function rankVariables(completions: readonly Completion[], query: string): Completion[] {
  return rankByQuery(completions, query, labelField).map(({ item }) => item);
}

/** Where `query` matches the completion's label; undefined for a blank query or no match. */
export function variableRanges(
  query: string,
  completion: Completion,
): readonly MatchRange[] | undefined {
  return matchFields(query, labelField(completion))?.ranges.label;
}

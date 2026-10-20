import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstallRecord } from './state.js';

/**
 * Built-in resources the service writes into user-editable locations, and the versions it has
 * shipped. The current content is always computed from what this build ships (the skill template
 * directory, the default role in builtins/role.ts), never listed here.
 *
 * When shipped content changes, bump `version` and keep the fingerprint of every released version
 * in `history`, oldest first; a version reaches `history` once a release tag ships it. An
 * untouched copy upgrades on its own: one whose install record still matches it, or, without a
 * record, one equal to a released version. Any other copy is the user's: an edit of the content
 * this build ships is kept; one based on other content is, for a product skill, backed up and
 * replaced (builtins/skills.ts), and for the default role kept with an update offered to restore.
 * Fingerprints come from builtins/fingerprint.ts; for a released skill,
 * fingerprint its directory as `git archive <tag>` extracts it.
 */
export interface BuiltinEntry {
  /** `skill:<name>` or `role:<id>`; the restore route takes it URL-encoded. */
  id: string;
  kind: 'skill' | 'role';
  /** Skill directory name, or role id. */
  name: string;
  version: number;
  /** Fingerprints of every shipped version (see the module comment). */
  history: readonly string[];
}

/** What a builtin resource's copy is relative to the shipped version. */
export type BuiltinState = 'current' | 'modified' | 'update_available';

/**
 * Wire status of one builtin resource; `version` is the shipped version. `backupPath` is where a
 * reconcile backed up the user's changed copy before replacing it, until they dismiss the notice.
 */
export interface BuiltinStatus {
  id: string;
  version: number;
  status: BuiltinState;
  backupPath?: string;
}

/** What reconciling one resource does. */
export type ReconcileAction = 'install' | 'record' | 'keep' | 'none';

function skill(name: string, version: number, history: string[]): BuiltinEntry {
  return { id: `skill:${name}`, kind: 'skill', name, version, history };
}

/**
 * Product skills, installed as whole directories into `<atdHome>/skills/<name>`. Each `history`
 * holds the fingerprints of the versions releases shipped, oldest first, with the first tag that
 * shipped each.
 */
export const BUILTIN_SKILLS: readonly BuiltinEntry[] = [
  // Version 6 asks, through ask_user with recommended options, only when a skill applies and the
  // steps the request leaves open; saves one model-loadable SKILL.md by default and reports the
  // defaults it assumed, since the write may not ask; and keeps the description's intent within
  // the 250 characters the catalog shows.
  // Version 7 resolves the Personal catalog from the loaded skill's base directory, so isolated
  // profiles use their own product home without widening access to the rest of their data dir.
  skill('create-skill', 7, [
    '52ab561a0217ae8a36d38f325cac6ad50fef2e9a08ebe2b909cf583a49c1f4ae', // v0.1.0
    'd1a926174cf39e889bb828f533cd6e5025753dd5f5b58a907d1298207240a261', // v0.2.0
    '507a3dd5b0aaf1bad22e95b69a725d70f57c4be00dbd1c0517d1705a360a177b', // v0.3.0
    '2140d55c1734d3af7e809a67179880c6d4b202c5ec6911ceebb4219746940945', // v0.4.0
    '291d1d6f98f5267e6363b205e6e4cf27929929830374e1b1420135383b6dbb2f', // v0.7.0
    'bf8c5d94445d00bc0ea07712ca6be924617c57fad151c7a76960a6865e242bcf', // v0.8.0
  ]),
  // Version 5 drops the subagent model, which runs never apply (children use the parent run's
  // model with reasoning off), asks through ask_user what the subagent may do (its tools) and, when
  // vague, when to delegate to it, and saves without a draft since the write always shows the file.
  // Version 6 resolves the Personal agents directory from this skill's active product home.
  skill('create-subagent', 6, [
    'afcd5e17fcd95c7a24175b9ad23b1d34fa5d7ec91a2ba2535b3708d2f8a18716', // v0.1.0
    '8d375554aef2b10a951ae07c8fa1b08e8ca14a4099fbb160c61e74ccd43217f9', // v0.2.0
    '037b52d1b12f3eb384c20b4613592d4b166fd6cd6ab88ceb656cbfea5e472e5a', // v0.3.0
    'd9b472312c181712db6891c44c99eac33ba131b5f8fa9e65ed333321a510126a', // v0.7.0
    '8b302d312310a13a717679bf6dec11e4a4a447123ed2b238e5cca9a35b4699a9', // v0.8.0
  ]),
  // Version 4 asks through ask_user only which server to add when the request names a capability
  // and how a remote server signs in, never for commands, URLs or secrets; relies on configure_mcp
  // asking the user to confirm every save; and tells the user which environment variable holds a
  // bearer token and how to set it for the app.
  skill('create-mcp', 4, [
    'a6b2db9e4c7a64c07d796c9a185485c3066891e5347cabca2c60e9493fe53a9a', // v0.1.0
    '0218f3a2554a829f7a8b88804ff7ed3b5735256d72b82cd9b1f79afe0d0f6917', // v0.2.0
    '077f36db740d59e1db3a53a8fd6a5e6edfd21a6d19b54c7d10bf136cc0c08588', // v0.3.0
  ]),
  skill('plan-mode', 2, [
    '5f1235318d9257d80386978821d81716ba17e4f7f246f88ef4ecb6e7db791d7b', // v0.1.0
    '732475e07f6357b331dd900d716353f6d30545aa7e418fe7841a693e9ad7ec5b', // v0.7.0
  ]),
  skill('grill-me', 1, [
    '67b57791c003d7a625a77ffa09057ddfbfe303a8c38bc2d5e5b310346e5c848f', // v0.1.0
  ]),
  // Version 4 saves the user's own wording at once and otherwise asks once, through ask_user,
  // whether to save the proposed memory as written, reword it or not save it.
  skill('create-memory', 4, [
    'f313bd78fc680783f18d1eacc387bb04acac33890c5d9e51121ab3f9a2ebdf2e', // v0.1.0
    '27713671066dcb1661f796a5bca20b420c6aff4890966a865ed188cac3d8cbc9', // v0.3.0
    '3dbd0e3190798314786266117667c12532b6ba366fb7746fc0e5ce702e6a0453', // v0.7.0
  ]),
  // Version 2 says that the Agent sets where a command's answer goes (its output) but leaves where
  // it is offered and its model to Settings, that it may set a command's own reasoning level only
  // when the user asks for one, that a command without tools or references runs on the
  // lightweight path, and that a light command (a self-contained text transform) gets no tools or
  // memory and short result-only instructions. Before saving, the Agent asks the user, through
  // ask_user with recommended options, only about the few choices the request leaves open: where
  // the text comes from, where the answer goes, and whether each named value is fixed or a choice.
  // It relies on the run asking for the text when a selection command finds nothing selected,
  // writing that answer at the cursor, and showing an answer the app cannot take in a card. On
  // macOS a shortcut may be a modifier's double-tap, which needs Accessibility. The instructions
  // take the text a command works on through {{input}} alone, since a used variable is required
  // on every run. A parameter value is remembered once a run uses it or the user changes it in a
  // command's options or input step, and changing a parameter's default replaces it.
  // Version 3 replaces the single shortcut with a list of up to eight shortcuts, each an entry
  // point that may fix parameter values and override the answer's destination and the reasoning
  // level while the rest follows the command; says when to add a shortcut to a command and when
  // to create another one, that fixed values are never remembered, that a save's list replaces the
  // stored one (an id updates a shortcut, an omitted field keeps the list, [] removes it) and that
  // a shortcut's model is the user's to set in Settings.
  // Version 4 says that computer use is no command field or tool: the user picks the registered
  // targets for a run, editing a command that a computer automation runs voids that automation's
  // authorization, and targets need the add-on of their engine installed first.
  // Version 5 discovers the deferred management tool before using it.
  // Version 7 drops `computer.flow` and foreground routes: a repeated route is described by its
  // control labels and immediate checks, apps need no engine add-on (websites need the browser
  // engine), and every step runs in the background, so a step the app offers no other way to do
  // becomes one the run asks the user to do.
  skill('create-command', 7, [
    '5ca2e75cb515fcae3111580bb88925f2213f731916d8b671a787b178f8020b00', // v0.4.0
    '10d86caf2cef8420067ecb3258e5a462fd09c2785723ba03789e6b42a9c22122', // v0.8.0
    '810ed01dbd7273ddaf6d2b0f9a3fa1f63d8b72daa01106f366759592cceb4503', // v0.9.1
  ]),
  // Version 2 covers command reasoning defaults and the user's separate ChatGPT background consent,
  // asks through ask_user only when an automation runs, what each run produces and, for work that
  // writes or runs commands, what a run may do, and saves without a draft since the save confirms.
  // Version 3 lets the agent propose a computer scope (`policy.computer`) but never authorize it:
  // the user runs a trial and authorizes it in Settings, a new one is saved switched off, and only
  // the user resolves a hold; a scope's engines are add-ons the user installs, and without them a
  // trial cannot run and each run fails naming the missing add-on.
  // Version 4 discovers deferred automation and command management tools when needed.
  // Version 5 says that app targets need no engine install (their engine is built in) but are not
  // qualified for unattended runs, so a computer scope uses browser targets, whose engine is the
  // add-on a trial and each run need.
  skill('create-automation', 5, [
    'f390806f5e7adad1ce065e0c01c93ce4aaab1422bd7b776ffe6e05e1213f2fc1', // v0.7.0
    'fedcfc22a10b6877f5deef0aa01cc31d31e6b12ae2b230463aead37f8264a0ea', // v0.8.0
  ]),
  // Version 2 requires ChatGPT background consent for both model calls and app-started agents, and
  // asks at most three questions, one per ask_user call, never about the app's look, name or layout.
  // Version 3 states the WebKit 18.0 baseline: type checking is advisory and covers only ECMAScript
  // built-ins (fix it in web/ and shared/, ignore the ES2025 class in server/, which runs on Node
  // 24), DOM and CSS APIs need feature detection, the window material differs between macOS 15 and
  // 26, and widget symbols must exist on macOS 15.0.
  skill('create-app', 3, [
    'b06fa40069a44df38a73d234f70d1eb7a6fb8167c78f2d16dae3e3f07183a17b', // v0.7.0
    'e83225d07c69498f669a4e203b521d9915382a7c79cf2aa520205baf191f7c9b', // v0.8.0
  ]),
  // Teaches the `computer` tool: act only on targets approved for the run, observe
  // before and after every change, prove completion with an explicit postcondition rather than a
  // dispatched click, never retry an unknown or partial submit, and propose but never authorize an
  // automation's computer scope. Version 2 adds live setup diagnosis and screenshot/OCR
  // verification; attended runs keep the tool even before targets or engines are available.
  // Version 4 adds on-demand access: Manual lasts for the run; Auto and Always save approved
  // target access for later attended tasks. Access approval resumes the pending tool call.
  // Version 5 uses native menu state for playback verification instead of OCR icon guesses.
  // Version 6 resolves application mentions by bundle id through the existing access flow.
  // Version 7 uses returned nextObservation images and native regional newText baselines.
  // Version 8 describes host-owned typing feedback without agent pacing or split tool calls.
  // Version 9 bundles initial/recovery observations, exposes capture use-by deadlines, and
  // prefers app-reported playback state over redundant progress checks for start/stop requests.
  // Version 10 separates observed inputs from expected results and keeps advanced verification
  // and automation guidance in references loaded only when those conditions apply.
  // Version 12 adds system-selected screen sharing scoped to the current attended run.
  // Version 14 is background only: the host picks each step's route and never takes the person's
  // pointer, keyboard or screen; a step without a route is refused (`noBackgroundRoute` and its
  // reason) and handed to the person, `targetInUse` waits for them, `needsConsent` points to
  // preparing screen access in Settings and `disturbed` stops work on the target. Foreground
  // delivery, takeover and `flow` are gone, capture points need a background visual
  // qualification, and browser targets list no `click` step.
  skill('computer-use', 14, []),
  // Teaches `show_ui` and `update_ui`: show an inline view only when seeing and handling something
  // serves the user better than text, `ask_user` or an app; wait only for input the turn needs;
  // write messages that read as the user's own; close every loop with `update_ui`; and build to
  // the view runtime, the sandbox limits and the apple-design rules for a compact inline view.
  skill('generative-ui', 1, []),
];

/** The builtin default role in `<dataDir>/skills/roles.json`; every release shipped the same one. */
export const DEFAULT_ROLE_BUILTIN: BuiltinEntry = {
  id: 'role:default',
  kind: 'role',
  name: 'default',
  version: 1,
  history: [],
};

export function builtinEntry(id: string): BuiltinEntry | undefined {
  return id === DEFAULT_ROLE_BUILTIN.id
    ? DEFAULT_ROLE_BUILTIN
    : BUILTIN_SKILLS.find((entry) => entry.id === id);
}

/** Whether an `<atdHome>/skills` entry is a product skill: the service owns its slot. */
export function isBuiltinSkill(name: string): boolean {
  return BUILTIN_SKILLS.some((entry) => entry.name === name);
}

/**
 * Skill templates ship beside `dist/` (and next to `src/` in the repo). Both
 * `src/builtins/*.ts` and `dist/builtins/*.js` resolve to `../../product-skills`.
 */
export function builtinSkillsTemplateDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'product-skills');
}

/**
 * Decides what reconciling a copy does. Absent → install. Equal to the shipped content → record
 * it. Unmodified since the recorded install, or (without a record) equal to a shipped version →
 * install the shipped version over it. Anything else is the user's → keep it, and leave it to
 * the caller to replace an outdated one (see the module comment).
 */
export function reconcileAction(
  entry: BuiltinEntry,
  copy: string | null,
  latest: string,
  recorded: InstallRecord | undefined,
): ReconcileAction {
  if (copy === null) return 'install';
  if (copy === latest)
    return recorded?.fingerprint === latest && recorded.version === entry.version
      ? 'none'
      : 'record';
  const unmodified = recorded ? copy === recorded.fingerprint : entry.history.includes(copy);
  return unmodified ? 'install' : 'keep';
}

/**
 * Status of a copy after reconciling: `current` when it holds the shipped content; otherwise the
 * user changed it. When the user edited the content this build ships (its recorded base is the
 * shipped fingerprint) that is `modified`; when the shipped content differs from their base (or
 * there is no record) it is `update_available`. Comparing fingerprints, not `version`, keeps the
 * status right even when shipped content changes without a version bump.
 */
export function builtinStatus(
  entry: BuiltinEntry,
  copy: string,
  latest: string,
  recorded: InstallRecord | undefined,
): BuiltinStatus {
  const status: BuiltinState =
    copy === latest
      ? 'current'
      : recorded?.fingerprint !== latest
        ? 'update_available'
        : 'modified';
  const backupPath = recorded?.backupPath;
  return { id: entry.id, version: entry.version, status, ...(backupPath ? { backupPath } : {}) };
}

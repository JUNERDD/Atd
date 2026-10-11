import { Languages, PenLine, Plus, ScrollText } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01, easeInOut, ramp } from '../../motion/ease.ts';
import type { Rect } from '../world/points.ts';
import { ChatGPTContinue, ChatGPTWelcome, FieldNote } from './settings/ChatGPT.tsx';
import { CommandRow, COMMAND_ROW_PITCH, type CommandRowData } from './settings/CommandRow.tsx';
import { commandRowHold } from './settings/command-row.ts';
import { Button, FieldLabel, PrimaryButton, SearchField } from './settings/controls.tsx';
import { SelectMenu, SelectTrigger } from './settings/Select.tsx';
import { effortItems } from './settings/settings-strings.ts';
import { SettingsWindow } from './settings/SettingsWindow.tsx';
import { sheet08 } from './sheet-content-08.ts';
import { fill, strings } from './strings.ts';

const COMMANDS_BOX: Rect = { x: 40, y: 40, width: 1000, height: 600 };
const PROVIDER_BOX: Rect = { x: 1080, y: 40, width: 800, height: 420 };

/**
 * The settings page of the sheet (`t` 0 → 8 s): the Commands overview with a row armed, lifted
 * and dragged a place up as its sibling makes way (every 4 s), the Effort and Result selects open,
 * and the provider form's Continue with ChatGPT (at rest and signing in) under the first-success
 * dialog, which opens at 1 s and again every 4 s.
 */
export function SheetSettings({ lang, t }: { lang: Lang; t: number }) {
  const c = sheet08[lang];
  const st = strings[lang].settings;
  const out = strings[lang].command.output;
  const rows: CommandRowData[] = [
    {
      icon: Languages,
      name: c.translate,
      description: c.descriptions.translate,
      keys: ['⌥', 'T'],
      enabled: true,
    },
    {
      icon: PenLine,
      name: c.polish,
      description: c.descriptions.polish,
      keys: ['⌥', 'P'],
      enabled: true,
    },
    {
      icon: ScrollText,
      name: c.summarize,
      description: c.descriptions.summarize,
      keys: [],
      enabled: false,
    },
  ];
  const cycle = t % 4;
  const age = cycle - 0.6;
  const hold = commandRowHold(age);
  const travel = hold.lifted ? easeInOut(clamp01((age - 0.5) / 0.7)) : 0;
  const offsets = [COMMAND_ROW_PITCH * travel, -COMMAND_ROW_PITCH * travel, 0];
  const effort = effortItems(lang);
  const highlighted = Math.min(
    Math.floor(clamp01((cycle - 0.4) / 2.4) * effort.length),
    effort.length - 1,
  );
  const result = [
    out.panel,
    null,
    fill(st.output.savedTitle, { title: out.replaceSelection }),
    out.insertAfterSelection,
    out.insertAtCursor,
    null,
    out.copy,
  ];
  return (
    <div className="pk-sheet__layer">
      <SettingsWindow lang={lang} box={COMMANDS_BOX} section="commands">
        <div className="pk-sheet__page">
          <p className="pk-sheet__description">{st.commands.description}</p>
          <div className="pk-sheet__toolbar">
            <SearchField placeholder={st.commands.searchPlaceholder} />
            <PrimaryButton icon={Plus} label={st.commands.new} />
          </div>
          <p className="pk-sheet__hint">{st.commands.reorderHint}</p>
          <div className="pk-sheet__rows">
            {rows.map((row, index) => (
              <div
                key={row.name}
                className="pk-sheet__row-slot"
                style={{ '--dy': offsets[index] ?? 0 }}
              >
                <CommandRow
                  command={row}
                  emptyShortcut={st.commands.setShortcut}
                  hover={index === 1 && age > -0.3}
                  {...(index === 1 ? hold : {})}
                />
              </div>
            ))}
          </div>
        </div>
      </SettingsWindow>
      <div className="pk-sheet__field" data-at="effort">
        <FieldLabel label={st.run.effort} hint />
        <div className="pk-sheet__select">
          <SelectTrigger value={effort[1] ?? ''} />
          <SelectMenu items={effort} selected={1} highlighted={highlighted} opacity={1} />
        </div>
      </div>
      <div className="pk-sheet__field" data-at="result">
        <FieldLabel label={st.output.action} />
        <div className="pk-sheet__select">
          <SelectTrigger value={result[2] ?? ''} />
          <SelectMenu items={result} selected={2} highlighted={3} opacity={1} />
        </div>
      </div>
      <SettingsWindow lang={lang} box={PROVIDER_BOX} section="providers" subpage="OpenAI">
        <div className="pk-sheet__page">
          <FieldNote text={st.chatgpt.signInNote} />
          <div className="pk-sheet__footer">
            <Button variant="outline" label={st.chatgpt.cancel} />
            <ChatGPTContinue lang={lang} pressed={cycle > 0.7 && cycle < 0.85} />
          </div>
          <div className="pk-sheet__footer">
            <Button variant="outline" label={st.chatgpt.cancel} />
            <ChatGPTContinue lang={lang} signingIn />
          </div>
        </div>
      </SettingsWindow>
      <ChatGPTWelcome
        lang={lang}
        box={PROVIDER_BOX}
        appear={ramp(cycle, 1, 0.1)}
        pressed={cycle > 3.4 && cycle < 3.6}
      />
    </div>
  );
}

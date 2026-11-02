import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { MAX_COMMAND_ADJUSTMENT_LENGTH, MAX_COMMAND_ADJUSTMENTS } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Input } from '@atd/ui/components/input';
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { isComposingKey } from '@atd/ui/lib/ime';
import { IconButton } from '../../components/icon-button';
import { FieldError } from './field-error';

/** Why a suggestion cannot join the list. */
type Refusal = 'duplicate' | 'full' | 'tooLong';

/**
 * Why `text`, already trimmed, cannot join `adjustments`, or null when it can. The length counts
 * code points, as the service's schema (`CommandAdjustmentsSchema`) does.
 */
function refusal(adjustments: readonly string[], text: string): Refusal | null {
  if (adjustments.includes(text)) return 'duplicate';
  if (adjustments.length >= MAX_COMMAND_ADJUSTMENTS) return 'full';
  if (Array.from(text).length > MAX_COMMAND_ADJUSTMENT_LENGTH) return 'tooLong';
  return null;
}

/**
 * The command's adjustment suggestions, as a row of the review settings card: the
 * suggestions as removable chips in the order the review card offers them, then a field that adds
 * the trimmed text on Return (never while an input method composes). A suggestion the list
 * already holds, one past the count or one too long is refused with the reason under the field,
 * and the typed text stays for the person to fix.
 */
export function AdjustmentsRow({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (adjustments: string[]) => void;
}) {
  const { t } = useTranslation('commands');
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<{ reason: Refusal; text: string } | null>(null);
  const message =
    refused &&
    t(`output.adjustments.${refused.reason}`, {
      name: refused.text,
      max: refused.reason === 'full' ? MAX_COMMAND_ADJUSTMENTS : MAX_COMMAND_ADJUSTMENT_LENGTH,
    });
  const describedBy = [`${ids}-description`, message && `${ids}-error`].filter(Boolean).join(' ');
  function add() {
    const next = text.trim();
    if (!next) return;
    const reason = refusal(value, next);
    if (reason) {
      setRefused({ reason, text: next });
      return;
    }
    onChange([...value, next]);
    setText('');
    setRefused(null);
  }
  function remove(adjustment: string) {
    onChange(value.filter((item) => item !== adjustment));
    setRefused(null);
    // The chip's button goes with it; the field keeps the focus in the row.
    input.current?.focus();
  }
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">
            <Label htmlFor={`${ids}-input`}>{t('output.adjustments.title')}</Label>
          </ItemTitle>
          <ItemDescription id={`${ids}-description`} className="whitespace-normal">
            {t('output.adjustments.description')}
          </ItemDescription>
        </ItemContent>
        <ItemFooter className="flex-col items-stretch justify-start">
          {value.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label={t('output.adjustments.title')}>
              {value.map((adjustment) => (
                <li key={adjustment} className="flex max-w-full min-w-0">
                  <Badge
                    variant="secondary"
                    className="max-w-full overflow-visible pr-0.5"
                    title={adjustment}
                  >
                    <span className="truncate">{adjustment}</span>
                    <IconButton
                      size="icon-xs"
                      className="size-4 rounded-full"
                      label={t('common.remove')}
                      aria-label={t('output.adjustments.removeLabel', { name: adjustment })}
                      onClick={() => remove(adjustment)}
                    >
                      <X />
                    </IconButton>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Input
            ref={input}
            id={`${ids}-input`}
            value={text}
            placeholder={t('output.adjustments.placeholder')}
            aria-describedby={describedBy}
            aria-invalid={Boolean(message) || undefined}
            onChange={(event) => {
              setText(event.target.value);
              setRefused(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || isComposingKey(event)) return;
              event.preventDefault();
              add();
            }}
          />
          {message && <FieldError id={`${ids}-error`}>{message}</FieldError>}
        </ItemFooter>
      </li>
    </Item>
  );
}

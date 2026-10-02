import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';

/**
 * The header's restart into a downloaded update, shown only while one waits to install. The shell
 * installs it and relaunches through its quit flow, so running tasks still get their confirmation.
 */
export function UpdateButton() {
  const { t } = useTranslation('panel');
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => window.desktop?.update?.onState(setVersion), []);
  if (!version) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" onClick={() => window.desktop?.update?.install()}>
          {t('header.update')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {t('header.updateTooltip', { version })}
      </TooltipContent>
    </Tooltip>
  );
}

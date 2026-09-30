import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { isAppLanguage, type AppLanguage } from '../../client/settings-contract';
import { LANGUAGE_NAMES, LANGUAGE_OPTIONS } from '../../i18n/languages';
import { showErrorToast } from '../../components/toast-store';

/** Header control for the persisted UI language; the app language applies on the next snapshot. */
export function LanguageSelector({ language }: { language: AppLanguage }) {
  const { t } = useTranslation('settings');
  return (
    <Select
      value={language}
      onValueChange={(value) => {
        if (!isAppLanguage(value)) return;
        void window.desktop?.settings.setLanguage(value).catch(showErrorToast);
      }}
    >
      <SelectTrigger aria-label={t('language.label')} data-settings-anchor="language">
        <Languages className="size-4" aria-hidden="true" />
        <SelectValue>{LANGUAGE_NAMES[language]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LANGUAGE_OPTIONS.map(({ code, name }) => (
          <SelectItem key={code} value={code}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

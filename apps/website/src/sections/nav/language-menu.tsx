import { Check, Languages } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, LANGS, langPath, languageNames, rememberLang } from '../../i18n/routes';
import { navCopy } from './copy';
import './language-menu.css';

export function LanguageMenu() {
  const t = useCopy(navCopy);
  const lang = useLang();

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          className="btn-plain btn-icon language-menu__trigger"
          type="button"
          aria-label={t.language}
          title={t.language}
        >
          <Languages aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="language-menu__content"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          aria-label={t.language}
        >
          <DropdownMenu.RadioGroup value={lang}>
            {LANGS.map((code) => (
              <DropdownMenu.RadioItem
                className="language-menu__item"
                key={code}
                value={code}
                asChild
              >
                <a
                  href={langPath[code]}
                  hrefLang={htmlLang[code]}
                  lang={htmlLang[code]}
                  onClick={() => rememberLang(code)}
                >
                  {languageNames[code]}
                  <DropdownMenu.ItemIndicator className="language-menu__check">
                    <Check size={16} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </a>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { rankByQuery, type FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import { settingsSections, type SettingsSectionId } from './settings-sections';
import {
  SEARCH_NAMESPACES,
  SECTION_DESCRIPTIONS,
  SECTION_KEYWORDS,
  settingsSearchEntries,
  type SettingsSearchEntry,
} from './settings-search-index';

type SearchT = TFunction<typeof SEARCH_NAMESPACES>;
type Field = 'label' | 'section' | 'description' | 'keywords';
type SearchFields = Record<Field | `${Field}En`, string | undefined>;

/** A section row or a setting inside one, with the copy the results show. */
export interface SettingsSearchResult {
  entry: SettingsSearchEntry;
  /** What the row opens; null for a control outside every section. */
  section: SettingsSectionId | null;
  /** Whether the row is a section itself rather than a setting inside it. */
  isSection: boolean;
  label: string;
  /** The section's description for a section row, else the section's name. */
  secondary: string;
  match: FieldsMatch<Field | `${Field}En`> | null;
}

const sectionEntries: readonly SettingsSearchEntry[] = settingsSections.map(
  ({ id, labelKey }): SettingsSearchEntry => ({
    id: `section-${id}`,
    section: id,
    label: labelKey,
    description: SECTION_DESCRIPTIONS[id],
    keywords: SECTION_KEYWORDS[id],
  }),
);
const entries = [...sectionEntries, ...settingsSearchEntries];
const isSectionEntry = (entry: SettingsSearchEntry) => sectionEntries.includes(entry);

function sectionName(entry: SettingsSearchEntry, t: SearchT) {
  const section = settingsSections.find(({ id }) => id === entry.section);
  return section ? t(section.labelKey) : undefined;
}

function fieldsIn(entry: SettingsSearchEntry, t: SearchT) {
  return {
    label: t(entry.label),
    // A section row is its own section; matching its name twice would only add noise.
    section: isSectionEntry(entry) ? undefined : sectionName(entry, t),
    description: entry.description && t(entry.description),
    keywords: t(entry.keywords),
  };
}

/**
 * Settings and sections matching the query, best first; none for a blank query. Words are matched
 * against the label, section name, description and aliases in the UI language and in English, so
 * English terms find settings in the Chinese UI. A match in the label ranks above one only in the
 * other fields; each tier keeps `rankByQuery`'s order.
 */
export function useSettingsSearch(query: string): SettingsSearchResult[] {
  const { t, i18n } = useTranslation(SEARCH_NAMESPACES);
  if (!query.trim()) return [];
  const english = i18n.resolvedLanguage === 'en' ? null : i18n.getFixedT('en', SEARCH_NAMESPACES);
  const ranked = rankByQuery(entries, query, (entry): SearchFields => {
    const own = fieldsIn(entry, t);
    const en = english ? fieldsIn(entry, english) : null;
    return {
      ...own,
      labelEn: en?.label,
      sectionEn: en?.section,
      descriptionEn: en?.description,
      keywordsEn: en?.keywords,
    };
  });
  const inLabel = (match: SettingsSearchResult['match']) =>
    match !== null && (match.ranges.label.length > 0 || match.ranges.labelEn.length > 0);
  return ranked
    .map(({ item: entry, match }) => {
      const isSection = isSectionEntry(entry);
      return {
        entry,
        section: entry.section,
        isSection,
        label: t(entry.label),
        secondary:
          isSection && entry.description
            ? t(entry.description)
            : (sectionName(entry, t) ?? t('search.general')),
        match,
      };
    })
    .sort((a, b) => Number(!inLabel(a.match)) - Number(!inLabel(b.match)));
}

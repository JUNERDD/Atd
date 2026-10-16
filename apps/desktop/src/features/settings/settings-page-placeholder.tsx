import { Card } from '@atd/ui/components/card';
import {
  FieldsPlaceholder,
  ItemsPlaceholder,
  LoadingPlaceholder,
  TextPlaceholder,
} from '../../components/loading-placeholder';

/**
 * A `SettingsHeading` while its page loads, in the heading's own classes. An overview shows only
 * its description (its title is visually hidden: the breadcrumb names the section); a sub-page
 * shows its title at the 24/32 heading line, and a description under it when it has one.
 */
export function SettingsHeadingPlaceholder({
  subpage = false,
  description = true,
}: {
  subpage?: boolean;
  description?: boolean;
}) {
  return (
    <div className="settings-page-heading">
      <div className="settings-section-heading">
        {subpage && <TextPlaceholder size="heading" width="third" />}
        {description && <TextPlaceholder width="threeFifths" />}
      </div>
    </div>
  );
}

/**
 * A settings page before the settings snapshot arrives: an overview's heading over one titled
 * group of rows in a settings card, in the classes the General page uses for its groups.
 */
export function SettingsPagePlaceholder({ label }: { label: string }) {
  return (
    <div className="settings-page">
      <LoadingPlaceholder label={label}>
        <SettingsHeadingPlaceholder />
        <div className="settings-shortcut-groups">
          <div className="settings-shortcut-group">
            <TextPlaceholder width="quarter" />
            <Card size="sm" className="settings-card">
              <ItemsPlaceholder count={4} inCard />
            </Card>
          </div>
        </div>
      </LoadingPlaceholder>
    </div>
  );
}

/**
 * An editor sub-page (a command's or an automation's) opened before the item it edits is read:
 * the sub-page title over its fields, with the editor's 16px heading gap and the 3px inset its
 * fields keep for focus rings.
 */
export function SettingsEditorPlaceholder({ label }: { label: string }) {
  return (
    <LoadingPlaceholder label={label} className="gap-4">
      <SettingsHeadingPlaceholder subpage description={false} />
      <div className="p-0.75">
        <FieldsPlaceholder />
      </div>
    </LoadingPlaceholder>
  );
}

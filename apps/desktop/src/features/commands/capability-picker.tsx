import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@ai/ui/components/item';
import { Switch } from '@ai/ui/components/switch';
import { useServiceStatus } from '../service/use-service';

/** A command's capability selection: skills + role, saved as refs, frozen at accept. */
export function SkillsRolePicker({
  skills,
  roleId,
  onChange,
}: {
  skills: { name: string; revision?: string }[];
  roleId?: string;
  onChange: (value: { skills: { name: string; revision?: string }[]; roleId?: string }) => void;
}) {
  const { t } = useTranslation('commands');
  const [available, setAvailable] = useState<{ name: string; description: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  // The panel mounts while main is still connecting; fetch once the service is live and again
  // after every reconnect, since the service owns both lists.
  const connected = useServiceStatus().status?.state === 'connected';
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!bridge || !connected) return;
    void bridge.skills().then(
      (result) =>
        setAvailable(
          ((result.skills as { name: string; description: string; enabled?: boolean }[]) ?? [])
            .filter((skill) => skill.enabled !== false)
            .map((skill) => ({ name: skill.name, description: skill.description })),
        ),
      () => setAvailable([]),
    );
    void bridge.roles().then(
      (result) => setRoles((result.roles as { id: string; title: string }[]) ?? []),
      () => setRoles([]),
    );
  }, [connected]);
  const selected = new Set(skills.map((skill) => skill.name));
  return (
    <div className="settings-field">
      <Label>{t('capability.skills')}</Label>
      <p className="text-xs text-muted-foreground">{t('capability.skillsNote')}</p>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('capability.emptySkills')}</p>
      ) : (
        <ItemGroup>
          {available.map((skill) => (
            <Item
              key={skill.name}
              variant="outline"
              size="sm"
              className="grid grid-cols-[minmax(0,1fr)_auto]"
            >
              <ItemContent>
                <ItemTitle>{skill.name}</ItemTitle>
                <ItemDescription>{skill.description}</ItemDescription>
              </ItemContent>
              <div className="flex items-center">
                <Switch
                  aria-label={skill.name}
                  checked={selected.has(skill.name)}
                  onCheckedChange={(checked) =>
                    onChange({
                      skills: checked
                        ? [...skills, { name: skill.name }]
                        : skills.filter((item) => item.name !== skill.name),
                      roleId,
                    })
                  }
                />
              </div>
            </Item>
          ))}
        </ItemGroup>
      )}
      <Label htmlFor="capability-role">{t('capability.role')}</Label>
      <Select
        value={roleId ?? 'none'}
        onValueChange={(value) =>
          onChange({ skills, roleId: value === 'none' ? undefined : value })
        }
      >
        <SelectTrigger id="capability-role" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('capability.noRole')}</SelectItem>
          {roles.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

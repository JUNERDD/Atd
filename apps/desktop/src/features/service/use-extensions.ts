import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PluginDetail } from '@ai/agent-contracts';
import { useAgent } from '../agent/use-agent';
import type { ExtensionCommandRow } from './extension-commands';
import { USER_PLUGIN_ID } from './plugin-rows';
import { useExtensionMutations } from './use-extension-mutations';
import type { ExtensionItemKind } from './use-extension-route';
import { findPluginItem } from './use-plugin-detail';
import { usePluginMutations } from './use-plugin-mutations';
import {
  useServiceAgents,
  useServicePlugins,
  useServiceSkills,
  useServiceStatus,
} from './use-service';
import { useServiceMcp } from './use-service-mcp';

/** One skill, subagent or MCP server switch, with what decides where its state is kept. */
export interface ExtensionItemTarget {
  pluginId: string;
  /** Installed plugins keep item switches themselves; host plugins keep them in their stores. */
  origin: 'host' | 'installed';
  kind: ExtensionItemKind;
  /** The name the catalogs use (qualified for installed plugins). */
  name: string;
  /** The name inside the plugin, which the plugin routes take; null when only the detail says. */
  localName: string | null;
}

/**
 * The Extensions section's data: the plugin list, the skill/subagent/MCP catalogs behind plugin
 * pages and search, and the commands of the agent snapshot, with their writes. Everything reloads
 * on connect and on the service's `extensions` change event; plugin counts and open plugin pages
 * (`epoch`, moved by each plugin reload) also follow command and memory changes, which reach the
 * app through the agent bridge.
 */
export function useExtensions() {
  const { status } = useServiceStatus();
  const connected = status?.state === 'connected';
  const skills = useServiceSkills();
  const agents = useServiceAgents();
  const mcp = useServiceMcp();
  const plugins = useServicePlugins();
  const mutations = useExtensionMutations();
  const pluginMutations = usePluginMutations();
  const commands = useAgent().snapshot?.commands ?? null;
  // The user's own commands carry no plugin id: they are the Personal plugin's.
  const commandRows = useMemo<ExtensionCommandRow[]>(
    () =>
      (commands ?? []).map((command) => ({
        pluginId: command.pluginId ?? USER_PLUGIN_ID,
        // The plugin detail addresses a Personal command by id, a plugin's by its qualified name.
        itemName: command.pluginId ? command.name : command.id,
        id: command.id,
        name: command.name,
        description: command.description,
        enabled: command.enabled,
        templateId: command.templateId,
      })),
    [commands],
  );
  const { refresh: refreshSkills, setEnabled: showSkill } = skills;
  const { refresh: refreshAgents, setEnabled: showAgent } = agents;
  const { refresh: refreshMcp, setEnabled: showMcp } = mcp;
  const { refresh: refreshPlugins, setEnabled: showPlugin } = plugins;
  const { setSkillEnabled, setAgentEnabled, mcpSetEnabled } = mutations;
  const { setEnabled: savePlugin, setItemEnabled: savePluginItem } = pluginMutations;

  const refreshAll = useCallback(() => {
    void refreshSkills();
    void refreshAgents();
    void refreshMcp();
    void refreshPlugins();
  }, [refreshAgents, refreshMcp, refreshPlugins, refreshSkills]);

  useEffect(() => {
    if (!connected) return;
    refreshAll();
    // Another client (the desktop app or a browser) changed the extensions.
    return window.desktop?.service?.onChange((event) => {
      if (event.type === 'extensions') refreshAll();
    });
  }, [connected, refreshAll]);
  useEffect(() => {
    if (!connected) return;
    return window.desktop?.agent?.onChange((event) => {
      if (event.type === 'memory') void refreshPlugins();
    });
  }, [connected, refreshPlugins]);
  // Snapshots arrive for every task change; only a change to the command set reloads plugins.
  const commandsKey =
    commands?.map((item) => `${item.id}:${item.enabled}:${item.pluginId ?? ''}`).join('\n') ?? '';
  const seenCommands = useRef(commandsKey);
  useEffect(() => {
    if (seenCommands.current === commandsKey) return;
    seenCommands.current = commandsKey;
    if (connected) void refreshPlugins();
  }, [commandsKey, connected, refreshPlugins]);

  const seqs = useRef(new Map<string, number>());
  /**
   * Shows a switch change at once and reverts it when the write fails, unless a later change to
   * the same switch already superseded it.
   */
  const toggle = useCallback(
    (
      key: string,
      enabled: boolean,
      show: (enabled: boolean) => void,
      save: (enabled: boolean) => Promise<unknown>,
    ) => {
      const seq = (seqs.current.get(key) ?? 0) + 1;
      seqs.current.set(key, seq);
      show(enabled);
      void save(enabled).catch(() => {
        if (seqs.current.get(key) === seq) show(!enabled);
      });
    },
    [],
  );

  /** An item switch; `patch` also shows the change on an open plugin page. */
  const setItemEnabled = useCallback(
    (target: ExtensionItemTarget, enabled: boolean, patch?: (enabled: boolean) => void) => {
      const show = (value: boolean) => {
        if (target.kind === 'skill') showSkill(target.name, value);
        else if (target.kind === 'agent') showAgent(target.name, value);
        else showMcp(target.name, value);
        patch?.(value);
      };
      const save = async (value: boolean) => {
        if (target.origin === 'installed') {
          const { pluginId: id, kind } = target;
          const name = target.localName ?? (await findPluginItem(id, kind, target.name)).localName;
          return savePluginItem({ id, kind, name, enabled: value });
        }
        if (target.kind === 'skill') return setSkillEnabled(target.name, value);
        if (target.kind === 'agent') return setAgentEnabled(target.name, value);
        return mcpSetEnabled(target.name, value, refreshMcp);
      };
      toggle(`${target.kind}\n${target.name}`, enabled, show, save);
    },
    [
      mcpSetEnabled,
      refreshMcp,
      savePluginItem,
      setAgentEnabled,
      setSkillEnabled,
      showAgent,
      showMcp,
      showSkill,
      toggle,
    ],
  );

  /**
   * A command or memory switch, which the service keeps for every plugin (a Personal command's own
   * `enabled`, the memory pause) and no catalog row shows; the agent snapshot brings the change to
   * the Commands and Memory sections. `patch` shows it on an open plugin page at once.
   */
  const setServiceItemEnabled = useCallback(
    (
      target: {
        pluginId: string;
        kind: 'command' | 'memory';
        itemName: string;
        localName: string | null;
      },
      enabled: boolean,
      patch?: (enabled: boolean) => void,
    ) => {
      const { pluginId: id, kind, itemName } = target;
      toggle(
        `${kind}\n${id}\n${itemName}`,
        enabled,
        (value) => patch?.(value),
        async (value) => {
          const name = target.localName ?? (await findPluginItem(id, kind, itemName)).localName;
          return savePluginItem({ id, kind, name, enabled: value });
        },
      );
    },
    [savePluginItem, toggle],
  );

  /** A plugin switch; `onSaved` receives the plugin's new detail for an open plugin page. */
  const setPluginEnabled = useCallback(
    (id: string, enabled: boolean, onSaved?: (detail: PluginDetail) => void) => {
      toggle(
        `plugin\n${id}`,
        enabled,
        (value) => showPlugin(id, value),
        async (value) => {
          // Save first: an optional call would skip evaluating its argument when nothing listens.
          const detail = await savePlugin(id, value);
          onSaved?.(detail);
        },
      );
    },
    [savePlugin, showPlugin, toggle],
  );

  return {
    connected,
    /** The service connection's state; null until the first status read answers. */
    serviceState: status?.state ?? null,
    skills,
    agents,
    mcp,
    plugins,
    commands: commandRows,
    epoch: plugins.epoch,
    mutations,
    pluginMutations,
    busy: mutations.busy ?? pluginMutations.busy,
    refreshAll,
    setItemEnabled,
    setServiceItemEnabled,
    setPluginEnabled,
  };
}

export type Extensions = ReturnType<typeof useExtensions>;

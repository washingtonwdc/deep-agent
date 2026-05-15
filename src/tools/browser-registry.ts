/*
 * File: browser-registry.ts
 * Project: deepsproxy
 * Registers all browser tools from browser-tools.ts into the ToolRegistry singleton.
 * Import this module once at startup (index.ts) to make the tools available
 * to AgentEngine, executor.ts and any other consumer of the registry.
 */

import { registry } from './registry.ts';
import { agentTools } from '../services/browser-tools.ts';

export function registerBrowserTools(): void {
  for (const tool of agentTools) {
    if (registry.has(tool.name)) continue;

    registry.register(
      tool.name,
      tool.description,
      tool.parameters as any,
      async (args) => tool.execute(args),
      false
    );
  }
}

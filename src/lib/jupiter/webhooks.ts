// src/lib/jupiter/webhooks.ts
//
// Webhook definitions for Jupiter Perps signal actions.

import { createHash } from "crypto";

export type VaultWebhookAction = "open_long" | "close_long" | "open_short" | "close_short";

export type WebhookDefinition = {
  hookId: string;
  action: VaultWebhookAction;
  label: string;
  description: string;
  badgeTone: "emerald" | "rose" | "violet" | "amber";
};

function stableHookId(vaultPk: string, action: string): string {
  return createHash("sha256")
    .update(`amyth:jupiter:${vaultPk}:${action}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildWebhookDefinitions(vaultPk: string): WebhookDefinition[] {
  return [
    {
      hookId: stableHookId(vaultPk, "open_long"),
      action: "open_long",
      label: "Open Long",
      description: "Opens or increases a long position via Jupiter Perps.",
      badgeTone: "emerald",
    },
    {
      hookId: stableHookId(vaultPk, "close_long"),
      action: "close_long",
      label: "Close Long",
      description: "Closes / reduces the current long position.",
      badgeTone: "rose",
    },
    {
      hookId: stableHookId(vaultPk, "open_short"),
      action: "open_short",
      label: "Open Short",
      description: "Opens or increases a short position via Jupiter Perps.",
      badgeTone: "violet",
    },
    {
      hookId: stableHookId(vaultPk, "close_short"),
      action: "close_short",
      label: "Close Short",
      description: "Closes / reduces the current short position.",
      badgeTone: "amber",
    },
  ];
}

export function normalizeWebhookAction(input: {
  action: string;
  signal?: string;
  reduceOnly?: boolean;
}): { action: VaultWebhookAction; signal: string; requiresSize: boolean; reduceOnlyDefault: boolean } | null {
  const a = String(input.action || "").trim().toLowerCase();

  switch (a) {
    case "open_long":
      return { action: "open_long", signal: "long", requiresSize: true, reduceOnlyDefault: false };
    case "close_long":
      return { action: "close_long", signal: "flat", requiresSize: false, reduceOnlyDefault: true };
    case "open_short":
      return { action: "open_short", signal: "short", requiresSize: true, reduceOnlyDefault: false };
    case "close_short":
      return { action: "close_short", signal: "flat", requiresSize: false, reduceOnlyDefault: true };
    default:
      return null;
  }
}

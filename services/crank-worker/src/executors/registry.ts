import type { ActionDefinition, ActionType, ArgumentValue, CrankTask } from "../types.js";

function u64(value: unknown): ArgumentValue {
  if (typeof value === "bigint") return { kind: "u64", value: value.toString() };
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return { kind: "u64", value: String(value) };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return { kind: "u64", value };
  throw new Error(`Invalid u64 argument: ${String(value)}`);
}

function address(value: unknown): ArgumentValue {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Missing address argument");
  }
  return { kind: "address", value };
}

function optionalAddress(task: CrankTask, key: string): ArgumentValue {
  const value = task.payload[key];
  return value === undefined ? { kind: "source", value: "" } : address(value);
}

const DEFINITIONS: readonly ActionDefinition[] = [
  {
    actionType: "execute_scheduled_payment",
    contract: "payment",
    functionName: "execute_scheduled_payment",
    args: (task) => [u64(task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: false,
  },
  {
    actionType: "execute_recurring_payment",
    contract: "payment",
    functionName: "execute_recurring_payment",
    args: (task) => [u64(task.subscriptionId ?? task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: true,
  },
  {
    actionType: "execute_metered_billing",
    contract: "payment",
    functionName: "execute_metered_billing",
    args: (task) => [u64(task.subscriptionId ?? task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: true,
  },
  {
    actionType: "retry_failed_payment",
    contract: "payment",
    functionName: "retry_failed_payment",
    args: (task) => [u64(task.subscriptionId ?? task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: true,
  },
  {
    actionType: "emit_trial_conversion_notice",
    contract: "payment",
    functionName: "emit_trial_conversion_notice",
    args: (task) => [u64(task.subscriptionId ?? task.entityId)],
    requiresMerchantAuth: true,
    circuitScoped: false,
  },
  {
    actionType: "trigger_scheduled_payout",
    contract: "payment",
    functionName: "trigger_scheduled_payout",
    args: (task) => [optionalAddress(task, "merchant")],
    requiresMerchantAuth: true,
    circuitScoped: false,
  },
  {
    actionType: "expire_payment",
    contract: "payment",
    functionName: "expire_payment",
    args: (task) => [u64(task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: false,
  },
  {
    actionType: "trigger_arbitration_timeout",
    contract: "refund",
    functionName: "trigger_arbitration_timeout",
    args: (task) => [u64(task.entityId)],
    requiresMerchantAuth: false,
    circuitScoped: false,
  },
  {
    actionType: "cleanup_stale_escrow",
    contract: "escrow",
    functionName: "settle_dormant_escrow",
    args: (task) => [u64(task.entityId), { kind: "source", value: "" }],
    requiresMerchantAuth: false,
    circuitScoped: false,
  },
];

const BY_ACTION = new Map<ActionType, ActionDefinition>(DEFINITIONS.map((definition) => [definition.actionType, definition]));

export const ACTION_TYPES: readonly ActionType[] = DEFINITIONS.map((definition) => definition.actionType);

export function getActionDefinition(task: CrankTask): ActionDefinition {
  const definition = BY_ACTION.get(task.actionType);
  if (definition === undefined) {
    throw new Error(`Unsupported crank action: ${task.actionType}`);
  }
  if (definition.contract !== task.contract) {
    throw new Error(`Action ${task.actionType} requires a ${definition.contract} contract, got ${task.contract}`);
  }
  return definition;
}

export function listActionDefinitions(): readonly ActionDefinition[] {
  return DEFINITIONS;
}

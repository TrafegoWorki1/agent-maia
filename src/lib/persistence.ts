import { seedAudit, seedChatMessages, seedMembers } from "../data/seed";
import type { DemoState } from "./types";

// v3: remove dados de exemplo salvos nas versões anteriores deste navegador.
export const DEMO_STORAGE_KEY = "operaflow-maia-demo-v3";

function initialState(): DemoState {
  return {
    members: structuredClone(seedMembers),
    actions: [],
    approvals: [],
    audit: structuredClone(seedAudit),
    messages: structuredClone(seedChatMessages),
  };
}

export function createInitialState(): DemoState {
  return initialState();
}

export function loadDemoState(): DemoState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    if (
      !Array.isArray(parsed.members) ||
      !Array.isArray(parsed.actions) ||
      !Array.isArray(parsed.approvals) ||
      !Array.isArray(parsed.audit) ||
      !Array.isArray(parsed.messages)
    ) {
      return initialState();
    }
    return parsed as DemoState;
  } catch {
    return initialState();
  }
}

export function saveDemoState(state: DemoState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A indisponibilidade do armazenamento não bloqueia a demonstração em memória.
  }
}

export function resetDemoState(): DemoState {
  const state = initialState();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      // O estado inicial ainda pode ser usado nesta sessão.
    }
  }
  return state;
}

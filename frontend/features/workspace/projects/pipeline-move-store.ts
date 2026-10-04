import { useSyncExternalStore } from "react";
import type { ProjectStatus } from "../../../app/lib/api";

type MoveNotice = { title: string; status: string };
type MoveState = {
  pending: { id: string; status: ProjectStatus } | null;
  notice: MoveNotice | null;
  error: string | null;
};
const idle: MoveState = { pending: null, notice: null, error: null };
const states = new Map<string, MoveState>();
const operations = new Map<string, symbol>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (scope: string, state: MoveState) => { states.set(scope, state); listeners.forEach(listener => listener()); };

// A pending write belongs to the workspace, not a route mount. Leaving and returning
// to the board cannot start another write before the first response is reconciled.
export function usePipelineMoveState(scope: string) {
  const state = useSyncExternalStore(subscribe, () => states.get(scope) ?? idle, () => idle);
  return {
    ...state,
    begin(id: string, status: ProjectStatus) {
      if (states.get(scope)?.pending) return null;
      const operation = Symbol(scope);
      operations.set(scope, operation);
      publish(scope, { pending: { id, status }, notice: null, error: null });
      return operation;
    },
    finish(operation: symbol, error: string | null, notice: MoveNotice | null) {
      if (operations.get(scope) !== operation) return;
      operations.delete(scope);
      publish(scope, { pending: null, error, notice });
    }
  };
}

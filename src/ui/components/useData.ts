import type { GameData } from '@sim/types';
import { useStore } from '@ui/store';

/** Convenience accessor for `store.data`. May be null before `boot()` resolves —
 *  screens must guard for null themselves (render a "No data" Panel) rather than
 *  assume this is always populated. */
export function useData(): GameData | null {
  return useStore((s) => s.data);
}

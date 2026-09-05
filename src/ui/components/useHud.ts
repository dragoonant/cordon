import { useStore } from '@ui/store';

/** Subscribe to the store's HUD tick (~10Hz) to force re-renders for
 *  components that read mutable sim state (world/run) directly rather than
 *  through store fields that change identity. */
export function useHud(): number {
  return useStore((s) => s.hudTick);
}

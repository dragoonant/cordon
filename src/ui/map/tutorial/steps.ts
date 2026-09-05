/**
 * CORDON — first-map coach-mark step definitions.
 * Pure data; `useTutorial` owns the state machine that walks through these.
 */
export interface TutorialStep {
  id: 'deploy' | 'move' | 'hold' | 'contact' | 'aftermath' | 'victory';
  text: string;
  /** CSS selector for the real UI element to highlight, or null for an unanchored hint. */
  anchor: string | null;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'deploy',
    text: 'Deploy a squadron from the Lantern.',
    anchor: '[data-tutorial="deploy-button"]',
  },
  {
    id: 'move',
    text: 'Click the map to move your squad toward an objective.',
    anchor: null,
  },
  {
    id: 'hold',
    text: "Hold inside an objective's ring with no enemies nearby to complete it.",
    anchor: '[data-tutorial="objectives-panel"]',
  },
  {
    id: 'contact',
    text: 'Contact! The Forecast shows your odds. Pick a Callout (optional), then COMMIT.',
    anchor: '[data-tutorial="commit-button"]',
  },
  {
    id: 'aftermath',
    text: 'Winning gives salvage. Keep pilots alive — death is permanent for this run.',
    anchor: null,
  },
  {
    id: 'victory',
    text: 'All required objectives done. Continue to the sector map.',
    anchor: null,
  },
];

/**
 * tools/voice/plan.ts — pure planning logic for the ElevenLabs voice pipeline.
 *
 * No fs, no network, no ElevenLabs SDK. Everything here is a plain function
 * over already-parsed data so it can be unit tested against small inline
 * fixtures (see plan.test.ts) without touching disk or the API. generate.ts
 * is the thin I/O shell that loads JSON, calls these functions, then does the
 * actual HTTP calls and file writes.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CalloutDef, CertificationDef, Id, PilotDef } from '../../src/sim/types';

export const DEFAULT_MAX_CHARS = 12000;

/** A single voice line to be generated for one pilot. */
export interface VoiceLine {
  pilotId: Id;
  /** Callout id, or the literal 'last' (Last Transmission) or 'finisher'. */
  lineKey: string;
  text: string;
  /** (a) = reachable prebattle/overworld callout line, (b) = last transmission, (c) = finisher. */
  category: 'callout' | 'last' | 'finisher';
}

export interface PilotVoicePlan {
  pilotId: Id;
  voiceKey: string;
  lines: VoiceLine[];
}

export interface DroppedLine {
  pilotId: Id;
  lineKey: string;
  chars: number;
}

export interface VoicePlan {
  pilots: PilotVoicePlan[];
  totalChars: number;
  totalLines: number;
  dropped: DroppedLine[];
  maxChars: number;
}

export interface VoiceData {
  pilots: Record<Id, PilotDef>;
  callouts: Record<Id, CalloutDef>;
  certs: Record<string, CertificationDef>;
}

export interface VoicePlanOptions {
  maxChars?: number;
  /** Restrict to these pilotDefIds, if given. */
  only?: Id[];
  /** Restrict to these line keys (callout id / 'last' / 'finisher'), if given. */
  lines?: string[];
}

/** faction 'relay' and archetype not 'captain', plus any pilot with archetype 'rival'. */
export function eligiblePilots(pilots: Record<Id, PilotDef>): PilotDef[] {
  return Object.values(pilots).filter(
    (p) => (p.faction === 'relay' && p.archetype !== 'captain') || p.archetype === 'rival'
  );
}

/**
 * Union of every callout id granted by any certification, restricted to the
 * kinds actually voiced on the forecast/map screens ('prebattle', 'overworld').
 * Per the spec this is intentionally NOT scoped to certs a given pilot could
 * actually reach — every relay/rival pilot gets every reachable callout line
 * in their own voice, since certs can be earned by anyone during a run.
 */
export function allCertGrantedCallouts(certs: Record<string, CertificationDef>, callouts: Record<Id, CalloutDef>): Id[] {
  const ids = new Set<Id>();
  for (const cert of Object.values(certs)) {
    for (const calloutId of cert.grantsCallouts ?? []) {
      const callout = callouts[calloutId];
      if (callout && (callout.kind === 'prebattle' || callout.kind === 'overworld')) {
        ids.add(calloutId);
      }
    }
  }
  return [...ids];
}

/** Builds the full (uncapped, unfiltered) per-pilot line set. */
export function buildPilotLines(pilot: PilotDef, data: VoiceData, certGranted: Id[]): VoiceLine[] {
  const lines: VoiceLine[] = [];
  const seen = new Set<string>();

  const calloutIds = new Set<Id>([...pilot.startingCallouts, ...certGranted]);
  for (const calloutId of calloutIds) {
    const callout = data.callouts[calloutId];
    if (!callout) continue; // dangling reference in data; skip rather than crash the plan
    if (callout.kind !== 'prebattle' && callout.kind !== 'overworld') continue;
    if (seen.has(calloutId)) continue;
    seen.add(calloutId);
    lines.push({ pilotId: pilot.id, lineKey: calloutId, text: callout.line, category: 'callout' });
  }

  const lastCallout = data.callouts[pilot.lastTransmissionId];
  if (lastCallout) {
    lines.push({ pilotId: pilot.id, lineKey: 'last', text: lastCallout.line, category: 'last' });
  }

  if (pilot.lines?.finisher) {
    lines.push({ pilotId: pilot.id, lineKey: 'finisher', text: pilot.lines.finisher, category: 'finisher' });
  }

  return lines;
}

function totalChars(pilots: PilotVoicePlan[]): number {
  let sum = 0;
  for (const p of pilots) {
    for (const l of p.lines) sum += l.text.length;
  }
  return sum;
}

/**
 * Builds the full voice generation plan: eligible pilots, their lines,
 * --only/--lines filtering, and --max-chars trimming.
 *
 * Trimming rule (per spec): if total characters exceed the cap, drop *all*
 * (a)-category (callout) lines for pilots in order of appearance — never (b)
 * last-transmission or (c) finisher lines — until the total is back under
 * the cap. Reports every dropped line.
 */
export function buildVoicePlan(data: VoiceData, options: VoicePlanOptions = {}): VoicePlan {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const certGranted = allCertGrantedCallouts(data.certs, data.callouts);

  let pilots = eligiblePilots(data.pilots);
  if (options.only && options.only.length > 0) {
    const onlySet = new Set(options.only);
    pilots = pilots.filter((p) => onlySet.has(p.id));
  }

  let plans: PilotVoicePlan[] = pilots.map((pilot) => {
    let lines = buildPilotLines(pilot, data, certGranted);
    if (options.lines && options.lines.length > 0) {
      const lineSet = new Set(options.lines);
      lines = lines.filter((l) => lineSet.has(l.lineKey));
    }
    return { pilotId: pilot.id, voiceKey: pilot.voiceKey, lines };
  });

  const dropped: DroppedLine[] = [];
  let total = totalChars(plans);

  if (total > maxChars) {
    for (let i = 0; i < plans.length && total > maxChars; i++) {
      const plan = plans[i];
      const keep: VoiceLine[] = [];
      for (const line of plan.lines) {
        if (line.category === 'callout' && total > maxChars) {
          dropped.push({ pilotId: plan.pilotId, lineKey: line.lineKey, chars: line.text.length });
          total -= line.text.length;
        } else {
          keep.push(line);
        }
      }
      plan.lines = keep;
    }
  }

  return {
    pilots: plans,
    totalChars: total,
    totalLines: plans.reduce((n, p) => n + p.lines.length, 0),
    dropped,
    maxChars,
  };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface VoiceManifest {
  version: 1;
  pilots: Record<Id, Record<string, string>>;
}

/**
 * Builds public/audio/voice/manifest.json content from a plan, including
 * only files that actually exist on disk under `audioDir` (so a partial or
 * failed generation run never advertises audio that isn't there). `audioDir`
 * is normally public/audio/voice, but tests pass a temp directory.
 */
export function buildManifest(plan: VoicePlan, audioDir: string): VoiceManifest {
  const manifest: VoiceManifest = { version: 1, pilots: {} };
  for (const pilotPlan of plan.pilots) {
    for (const line of pilotPlan.lines) {
      const filePath = path.join(audioDir, pilotPlan.pilotId, `${line.lineKey}.mp3`);
      if (!existsSync(filePath)) continue;
      manifest.pilots[pilotPlan.pilotId] ??= {};
      manifest.pilots[pilotPlan.pilotId][line.lineKey] = `/audio/voice/${pilotPlan.pilotId}/${line.lineKey}.mp3`;
    }
  }
  return manifest;
}

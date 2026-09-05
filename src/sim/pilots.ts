/**
 * CORDON — pilot lifecycle (run-sim).
 *
 * Pure except where a function name says otherwise (`grantCert`,
 * `applyGrowth`, `regenNerve`, `addBond`, `tickInjuries` all mutate their
 * pilot argument(s) in place; everything else returns a new value). No
 * randomness here — pilots.ts never needs it.
 */
import type { Aptitude, Aptitudes, Certification, FrameDef, GameData, Id, Pilot, PilotDef } from './types';

/**
 * Kill count at which a pilot becomes an Ace. Mirrors `RULES.ACE_KILLS` in
 * rules.ts (battle-sim); duplicated locally rather than imported so pilots.ts
 * has no dependency on that concurrently-authored module beyond `mechLoad`
 * used in hangar.ts. If rules.ts's value ever changes, update this too.
 */
const ACE_KILLS = 8;

/**
 * New Pilot from a PilotDef: full aptitudes/certs/callouts, ready to deploy.
 *
 * Note: `createPilot` takes no `data: GameData` per API.md's signature, so it
 * cannot resolve `CertificationDef.grantsCallouts` for `def.startingCerts`
 * (those live in `GameData.certs`, not on the PilotDef). `pilot.callouts` is
 * therefore seeded from `def.startingCallouts` only. Content authors should
 * list any callouts a pilot's starting certs grant directly in
 * `startingCallouts`; alternatively a caller with `data` in scope can follow
 * up with `grantCert(pilot, certId, data)` for each starting cert.
 */
export function createPilot(def: PilotDef): Pilot {
  return {
    id: def.id,
    aptitudes: { ...def.baseAptitudes },
    certs: [...def.startingCerts],
    callouts: [...def.startingCallouts],
    kills: 0,
    battles: 0,
    nerve: def.maxNerve,
    maxNerve: def.maxNerve,
    alive: true,
    injuredFor: 0,
    ace: false,
    bonds: {},
    morale: 70,
  };
}

/** Certs the pilot qualifies for but doesn't yet hold. */
export function checkNewCerts(pilot: Pilot, data: GameData): Certification[] {
  const out: Certification[] = [];
  for (const certDef of Object.values(data.certs)) {
    if (pilot.certs.includes(certDef.id)) continue;
    const meetsAptitudes = (Object.entries(certDef.requires) as [Aptitude, number][]).every(
      ([apt, threshold]) => pilot.aptitudes[apt] >= threshold
    );
    if (!meetsAptitudes) continue;
    const meetsCerts = certDef.requiresCerts.every((c) => pilot.certs.includes(c));
    if (!meetsCerts) continue;
    out.push(certDef.id);
  }
  return out;
}

/** Grants a cert and its callouts. Mutates `pilot`. No-op if already held. */
export function grantCert(pilot: Pilot, certId: Certification, data: GameData): void {
  if (pilot.certs.includes(certId)) return;
  pilot.certs.push(certId);
  const certDef = data.certs[certId];
  if (!certDef) return;
  for (const calloutId of certDef.grantsCallouts) {
    if (!pilot.callouts.includes(calloutId)) pilot.callouts.push(calloutId);
  }
}

/** Applies aptitude gains scaled by the pilot's growth multipliers. Mutates `pilot`. */
export function applyGrowth(pilot: Pilot, gains: Partial<Aptitudes>, def: PilotDef): void {
  for (const [apt, gain] of Object.entries(gains) as [Aptitude, number][]) {
    if (!gain) continue;
    const mult = def.growth[apt] ?? 1;
    const next = pilot.aptitudes[apt] + gain * mult;
    const clamped = Math.min(100, Math.max(0, next));
    pilot.aptitudes[apt] = Math.round(clamped * 10) / 10;
  }
}

/** Regenerates (or spends, if negative) Nerve, clamped to [0, maxNerve]. Mutates `pilot`. */
export function regenNerve(pilot: Pilot, amount: number): void {
  pilot.nerve = Math.min(pilot.maxNerve, Math.max(0, pilot.nerve + amount));
}

/** Adds bond points between two pilots, symmetrically. Mutates both. */
export function addBond(a: Pilot, b: Pilot, points: number): void {
  a.bonds[b.id] = (a.bonds[b.id] ?? 0) + points;
  b.bonds[a.id] = (b.bonds[a.id] ?? 0) + points;
}

/** Tandem callout ids available to this pair right now, from either side's bondPartners. */
export function availableTandems(a: Pilot, b: Pilot, data: GameData): Id[] {
  const out = new Set<Id>();
  const defA = data.pilots[a.id];
  const defB = data.pilots[b.id];
  if (defA) {
    for (const partner of defA.bondPartners) {
      if (partner.pilotId === b.id && (a.bonds[b.id] ?? 0) >= partner.threshold) out.add(partner.tandemCalloutId);
    }
  }
  if (defB) {
    for (const partner of defB.bondPartners) {
      if (partner.pilotId === a.id && (b.bonds[a.id] ?? 0) >= partner.threshold) out.add(partner.tandemCalloutId);
    }
  }
  return Array.from(out);
}

const WEIGHT_CERT: Record<FrameDef['weightClass'], Certification> = {
  light: 'cert_light',
  medium: 'cert_medium',
  heavy: 'cert_heavy',
};

/** Whether the pilot holds the weight cert this frame requires. */
export function canPilotFly(pilot: Pilot, frame: FrameDef): boolean {
  return pilot.certs.includes(WEIGHT_CERT[frame.weightClass]);
}

/** Decrements every pilot's injuredFor by 1 (floor 0). Mutates `pilots`. */
export function tickInjuries(pilots: Record<Id, Pilot>): void {
  for (const pilot of Object.values(pilots)) {
    if (pilot.injuredFor > 0) pilot.injuredFor -= 1;
  }
}

/** Whether the pilot has crossed the Ace kill threshold. */
export function isAce(pilot: Pilot): boolean {
  return pilot.kills >= ACE_KILLS;
}

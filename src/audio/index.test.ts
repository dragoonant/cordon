import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BattleEvent, GameData, WorldEvent } from '@sim/types';
import {
  initAudio,
  updateAudioSettings,
  loadVoiceManifest,
  hasVoice,
  playVoice,
  stopVoice,
  playSfx,
  playBattleSfx,
  playMapSfx,
  playMusic,
  stopMusic,
  duckMusic,
  isProceduralMusicActive,
  VoiceManifest,
  type SfxName,
} from './index';
import { buildPatch, type MusicTrack } from './procMusic';

describe('audio module', () => {
  // Import works in Node environment
  it('imports without error', () => {
    expect(initAudio).toBeDefined();
    expect(updateAudioSettings).toBeDefined();
    expect(loadVoiceManifest).toBeDefined();
    expect(hasVoice).toBeDefined();
    expect(playVoice).toBeDefined();
    expect(stopVoice).toBeDefined();
    expect(playSfx).toBeDefined();
    expect(playBattleSfx).toBeDefined();
    expect(playMapSfx).toBeDefined();
    expect(playMusic).toBeDefined();
    expect(stopMusic).toBeDefined();
    expect(duckMusic).toBeDefined();
  });

  // initAudio and updateAudioSettings don't throw
  it('initAudio does not throw', () => {
    expect(() => initAudio({ voice: true, music: 0.8, sfx: 0.5 })).not.toThrow();
    expect(() => initAudio({ voice: false, music: 0, sfx: 0 })).not.toThrow();
  });

  it('updateAudioSettings does not throw', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    expect(() => updateAudioSettings({ voice: false })).not.toThrow();
    expect(() => updateAudioSettings({ music: 0.5 })).not.toThrow();
    expect(() => updateAudioSettings({ sfx: 0.7 })).not.toThrow();
    expect(() => updateAudioSettings({})).not.toThrow();
  });

  // hasVoice returns false before manifest is loaded
  it('hasVoice returns false before manifest load', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    expect(hasVoice('pilot_veteran', 'deploy')).toBe(false);
  });

  describe('loadVoiceManifest', () => {
    beforeEach(() => {
      // Reset the global fetch stub for each test
      delete (globalThis as any).fetch;
    });

    it('returns null when fetch is undefined', async () => {
      const result = await loadVoiceManifest();
      expect(result).toBeNull();
    });

    it('returns null when fetch rejects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await loadVoiceManifest();
      expect(result).toBeNull();
    });

    it('returns null on 404 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      const result = await loadVoiceManifest();
      expect(result).toBeNull();
    });

    it('returns cached null on second call after failed fetch', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      await loadVoiceManifest();
      (globalThis.fetch as any).mockClear();
      const result = await loadVoiceManifest();
      expect(result).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // playVoice returns false when voice is disabled
  it('playVoice returns false when voice disabled', async () => {
    initAudio({ voice: false, music: 0.8, sfx: 0.5 });
    const result = await playVoice('pilot_veteran', 'deploy');
    expect(result).toBe(false);
  });

  // playSfx doesn't throw without AudioContext (Node has none)
  it('playSfx does not throw without AudioContext', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    const allNames: SfxName[] = [
      'burst', 'beam', 'rail', 'missiles', 'flak', 'lunge', 'slash', 'maul', 'repair',
      'hit', 'crit', 'miss', 'shield', 'explosion', 'eject', 'pilot_lost',
      'ui_click', 'ui_confirm', 'ui_back', 'callout', 'cutin', 'round', 'finisher',
      'rout', 'victory', 'defeat', 'alert', 'deploy', 'objective',
    ];
    for (const name of allNames) {
      expect(() => playSfx(name)).not.toThrow();
    }
  });

  // playSfx doesn't throw when sfx volume is 0
  it('playSfx is no-op when sfx volume is 0', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0 });
    expect(() => playSfx('ui_click')).not.toThrow();
  });

  // playBattleSfx / playMapSfx are no-ops in Node (no AudioContext) and never throw
  describe('playBattleSfx', () => {
    const gameData: GameData = {
      weapons: {
        w_burst: { id: 'w_burst', name: 'Burst', faction: 'relay', kind: 'ranged', damage: 10, hits: 1, accuracy: 80, crit: 10, frontMult: 1, backMult: 1, weight: 1, power: 1, tags: [], animKey: 'burst', unlockedByDefault: true },
      },
    } as unknown as GameData;

    beforeEach(() => {
      initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    });

    it('does not throw for an attack event with multiple hits and a kill', () => {
      const e: BattleEvent = {
        t: 'attack',
        side: 'A',
        attackerPilotId: 'p1',
        attackerMechId: 'm1',
        defenderPilotId: 'p2',
        defenderMechId: 'm2',
        weaponId: 'w_burst',
        hits: [
          { hit: true, damage: 10, crit: false },
          { hit: true, damage: 20, crit: true },
          { hit: false, damage: 0, crit: false },
        ],
        totalDamage: 30,
        defenderHpAfter: 0,
        killed: true,
      };
      expect(() => playBattleSfx(e, gameData)).not.toThrow();
    });

    it('does not throw for every BattleEvent variant', () => {
      const events: BattleEvent[] = [
        { t: 'start', sideA: 'A', sideB: 'B', terrain: 'open', weather: 'clear', mapKind: 'surface' },
        { t: 'callout', side: 'A', pilotId: 'p1', calloutId: 'c1', line: 'Eyes on.' },
        { t: 'round', n: 1 },
        { t: 'repair', side: 'A', pilotId: 'p1', mechId: 'm1', targetMechId: 'm2', amount: 10 },
        { t: 'shield', side: 'A', mechId: 'm1', absorbed: 5 },
        { t: 'intercept', side: 'A', protectorPilotId: 'p1', protectedPilotId: 'p2', calloutId: 'c1' },
        { t: 'destroyed', side: 'B', mechId: 'm2', pilotId: 'p2', pilotDied: true, ejected: false },
        { t: 'destroyed', side: 'B', mechId: 'm2', pilotId: 'p2', pilotDied: false, ejected: true },
        { t: 'last_transmission', side: 'A', pilotId: 'p1', calloutId: 'c1', line: 'line', effect: 'lt_go_home' },
        { t: 'cutin', side: 'A', pilotId: 'p1', kind: 'crit', line: 'line' },
        { t: 'finisher', side: 'A', pilotId: 'p1', name: 'Finisher', line: 'line' },
        { t: 'morale', side: 'A', delta: 5, reason: 'reason' },
        { t: 'rout', side: 'B', reason: 'reason' },
        { t: 'end', winner: 'A', reason: 'annihilation' },
        { t: 'end', winner: 'B', reason: 'rounds' },
        { t: 'end', winner: 'draw', reason: 'rounds' },
      ];
      for (const e of events) {
        expect(() => playBattleSfx(e, gameData)).not.toThrow();
      }
    });

    it('is a no-op when sfx volume is 0', () => {
      initAudio({ voice: true, music: 0.8, sfx: 0 });
      const e: BattleEvent = { t: 'round', n: 1 };
      expect(() => playBattleSfx(e, gameData)).not.toThrow();
    });
  });

  describe('playMapSfx', () => {
    beforeEach(() => {
      initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    });

    it('does not throw for every WorldEvent variant', () => {
      const events: WorldEvent[] = [
        { t: 'deployed', squadId: 's1' },
        { t: 'contact', squadAId: 's1', squadBId: 's2' },
        { t: 'battle_resolved', squadAId: 's1', squadBId: 's2', winner: 'A' },
        { t: 'objective', objectiveId: 'o1', status: 'pending' },
        { t: 'objective', objectiveId: 'o1', status: 'active' },
        { t: 'objective', objectiveId: 'o1', status: 'complete' },
        { t: 'objective', objectiveId: 'o1', status: 'failed' },
        { t: 'callout', squadId: 's1', pilotId: 'p1', calloutId: 'c1', line: 'line' },
        { t: 'last_transmission', pilotId: 'p1', calloutId: 'c1', line: 'line' },
        { t: 'squad_destroyed', squadId: 's1' },
        { t: 'squad_docked', squadId: 's1' },
        { t: 'spawn', squadId: 's1' },
        { t: 'carrier_hit', damage: 10, hpAfter: 50 },
        { t: 'captain', line: 'line' },
        { t: 'map_end', outcome: 'victory' },
      ];
      for (const e of events) {
        expect(() => playMapSfx(e)).not.toThrow();
      }
    });

    it('is a no-op when sfx volume is 0', () => {
      initAudio({ voice: true, music: 0.8, sfx: 0 });
      expect(() => playMapSfx({ t: 'deployed', squadId: 's1' })).not.toThrow();
    });
  });

  // stopVoice doesn't throw
  it('stopVoice does not throw', () => {
    expect(() => stopVoice()).not.toThrow();
  });

  // stopMusic doesn't throw
  it('stopMusic does not throw', () => {
    expect(() => stopMusic()).not.toThrow();
  });

  // duckMusic doesn't throw
  it('duckMusic does not throw', () => {
    expect(() => duckMusic(true)).not.toThrow();
    expect(() => duckMusic(false)).not.toThrow();
  });

  // playMusic doesn't throw in Node
  it('playMusic does not throw without Howl', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    expect(() => playMusic('battle')).not.toThrow();
  });

  // In Node there's no AudioContext, so playMusic() can't fall back to the
  // procedural generator either -- it should just stay inert.
  it('isProceduralMusicActive is false in Node (no AudioContext to fall back to)', async () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    expect(isProceduralMusicActive()).toBe(false);
    playMusic('battle');
    // Flush the microtask queue playMusic's musicTrackExists().then() runs on.
    await Promise.resolve();
    await Promise.resolve();
    expect(isProceduralMusicActive()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// procMusic: pure patch composition (no AudioContext needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('procMusic buildPatch', () => {
  const tracks: MusicTrack[] = ['title', 'map_space', 'map_surface', 'battle', 'boss', 'result'];

  it('returns a patch for every track without throwing', () => {
    for (const track of tracks) {
      expect(() => buildPatch(track)).not.toThrow();
    }
  });

  it('is deterministic: same track always yields the same patch', () => {
    for (const track of tracks) {
      const a = buildPatch(track);
      const b = buildPatch(track);
      expect(b).toEqual(a);
    }
  });

  it('tempo is upbeat: >= 110 BPM for every track (feedback: not slow/gothic)', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.tempoBpm).toBeGreaterThanOrEqual(110);
    }
  });

  it('specific tempos match the brief', () => {
    expect(buildPatch('title').tempoBpm).toBe(112);
    expect(buildPatch('map_surface').tempoBpm).toBe(128);
    expect(buildPatch('map_space').tempoBpm).toBe(124);
    expect(buildPatch('battle').tempoBpm).toBe(152);
    expect(buildPatch('boss').tempoBpm).toBe(160);
    expect(buildPatch('result').tempoBpm).toBe(120);
  });

  it('progression has a plausible chord count and in-range scale degrees', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.progression.length).toBeGreaterThanOrEqual(2);
      expect(patch.progression.length).toBeLessThanOrEqual(4);
      for (const degree of patch.progression) {
        expect(degree).toBeGreaterThanOrEqual(0);
        expect(degree).toBeLessThanOrEqual(6);
        expect(Number.isInteger(degree)).toBe(true);
      }
    }
  });

  it('melody is present with at least 8 hand-composed notes', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.melody.length).toBeGreaterThanOrEqual(8);
      for (const note of patch.melody) {
        expect(Number.isInteger(note.dur)).toBe(true);
        expect(note.dur).toBeGreaterThan(0);
      }
    }
  });

  it('melody durations sum to exactly one 8-bar loop (128 sixteenth-notes)', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      const total = patch.melody.reduce((s, n) => s + n.dur, 0);
      expect(total).toBe(128);
    }
  });

  it('scale is a 7-note diatonic mode', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.scale.length).toBe(7);
    }
  });

  it('drums are present for map/battle/boss tracks, absent for title/result', () => {
    expect(buildPatch('map_surface').hasDrums).toBe(true);
    expect(buildPatch('map_space').hasDrums).toBe(true);
    expect(buildPatch('battle').hasDrums).toBe(true);
    expect(buildPatch('boss').hasDrums).toBe(true);
    expect(buildPatch('title').hasDrums).toBe(false);
    expect(buildPatch('result').hasDrums).toBe(false);
  });

  it('battle and boss carry the driving pickup/crash/bass layer; others do not', () => {
    for (const track of ['battle', 'boss'] as MusicTrack[]) {
      const patch = buildPatch(track);
      expect(patch.hasPickup).toBe(true);
      expect(patch.hasCrash).toBe(true);
      expect(patch.drivingBass).toBe(true);
    }
    for (const track of ['title', 'map_space', 'map_surface', 'result'] as MusicTrack[]) {
      const patch = buildPatch(track);
      expect(patch.hasPickup).toBe(false);
      expect(patch.hasCrash).toBe(false);
      expect(patch.drivingBass).toBe(false);
    }
  });

  it('boss uses a minor mode; title/map/battle/result use major or mixolydian', () => {
    expect(buildPatch('boss').scaleName).toBe('aeolian');
    for (const track of ['title', 'map_space', 'map_surface', 'battle', 'result'] as MusicTrack[]) {
      expect(['major', 'mixolydian']).toContain(buildPatch(track).scaleName);
    }
  });

  it('result ends on a held big final chord', () => {
    expect(buildPatch('result').bigFinalChord).toBe(true);
    for (const track of ['title', 'map_space', 'map_surface', 'battle', 'boss'] as MusicTrack[]) {
      expect(buildPatch(track).bigFinalChord).toBe(false);
    }
  });
});

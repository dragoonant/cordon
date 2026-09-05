import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initAudio,
  updateAudioSettings,
  loadVoiceManifest,
  hasVoice,
  playVoice,
  stopVoice,
  playSfx,
  playMusic,
  stopMusic,
  duckMusic,
  isProceduralMusicActive,
  VoiceManifest,
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

  // playSfx doesn't throw without AudioContext
  it('playSfx does not throw without AudioContext', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0.5 });
    expect(() => playSfx('ui_click')).not.toThrow();
    expect(() => playSfx('hit')).not.toThrow();
    expect(() => playSfx('victory')).not.toThrow();
  });

  // playSfx doesn't throw when sfx volume is 0
  it('playSfx is no-op when sfx volume is 0', () => {
    initAudio({ voice: true, music: 0.8, sfx: 0 });
    expect(() => playSfx('ui_click')).not.toThrow();
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

  it('tempo is within a sane orchestral-ish range (60-160 BPM)', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.tempoBpm).toBeGreaterThanOrEqual(60);
      expect(patch.tempoBpm).toBeLessThanOrEqual(160);
    }
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

  it('motif is a fixed-length phrase (8-16 notes) with in-range scale degrees', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.motif.length).toBeGreaterThanOrEqual(8);
      expect(patch.motif.length).toBeLessThanOrEqual(16);
      for (const degree of patch.motif) {
        expect(degree).toBeGreaterThanOrEqual(0);
        expect(degree).toBeLessThanOrEqual(6);
        expect(Number.isInteger(degree)).toBe(true);
      }
    }
  });

  it('scale is a 7-note diatonic mode', () => {
    for (const track of tracks) {
      const patch = buildPatch(track);
      expect(patch.scale.length).toBe(7);
    }
  });

  it('battle and boss carry the percussive pulse layer; maps and result do not', () => {
    expect(buildPatch('battle').hasPulseDrum).toBe(true);
    expect(buildPatch('boss').hasPulseDrum).toBe(true);
    expect(buildPatch('map_space').hasPulseDrum).toBe(false);
    expect(buildPatch('map_surface').hasPulseDrum).toBe(false);
    expect(buildPatch('result').hasPulseDrum).toBe(false);
    expect(buildPatch('title').hasPulseDrum).toBe(false);
  });

  it('boss uses the brass-like lead stack; other tracks use plain triangle', () => {
    expect(buildPatch('boss').leadWave).toBe('brass');
    for (const track of tracks.filter((t) => t !== 'boss')) {
      expect(buildPatch(track).leadWave).toBe('triangle');
    }
  });
});

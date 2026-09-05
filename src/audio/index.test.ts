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
  VoiceManifest,
} from './index';

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
});

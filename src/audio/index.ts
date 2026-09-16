/**
 * CORDON audio module: voice, music, and SFX playback via Howler.
 *
 * Idempotent, safe to import in Node. All DOM/AudioContext access guarded.
 * Music and voice duck/fade automatically; SFX synthesized procedurally.
 *
 * Music fallback: playMusic() prefers a real mp3 at
 * public/audio/music/<track>.mp3 (HEAD-probed, cached in musicExists).
 * When that file isn't there -- true for every track tonight, since no
 * composed/licensed music exists yet -- it falls back to the procedural
 * WebAudio generator in procMusic.ts instead of no-op'ing. Both paths are
 * driven through the same crossfade code below: procMusic.ts's
 * ProceduralMusicPlayer implements the same play/fade/volume/stop surface
 * Howler's Howl does, so currentMusicHowl can hold either one and the rest
 * of this file (duckMusic, updateAudioSettings, stopMusic) doesn't need to
 * know which. isProceduralMusicActive() reports which one is live, mostly
 * for debugging/telemetry.
 */
import { Howl } from 'howler';

import { createProceduralMusic, type MusicTrack } from './procMusic';
import { getSfxAudioContext, playBattleSfx, playMapSfx, playSfx, setSfxVolume, type SfxName } from './sfx';
import { assetUrl } from '../assetUrl';

export { playBattleSfx, playMapSfx, playSfx, type SfxName };

// Check for browser environment (safe for vitest)
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function isOperating(): boolean {
  return isBrowser && typeof (window as any).AudioContext !== 'undefined';
}

export interface VoiceManifest {
  version: number;
  pilots: Record<string, Record<string, string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface AudioState {
  voice: boolean;
  music: number;
  sfx: number;
}

let state: AudioState = { voice: false, music: 0, sfx: 0 };
let voiceManifest: VoiceManifest | null = null;
let voiceManifestFetchAttempted = false;
let currentVoiceHowl: any = null;
// Holds either a Howler Howl (real mp3) or a ProceduralMusicPlayer
// (procMusic.ts fallback) -- both implement play/fade/volume/stop, so the
// rest of this module treats them interchangeably. See module comment.
let currentMusicHowl: any = null;
let currentMusicIsProcedural = false;

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize or reset audio settings. Idempotent; safe to call multiple times.
 */
export function initAudio(settings: { voice: boolean; music: number; sfx: number }): void {
  state = { ...settings };
  setSfxVolume(state.sfx);
}

/**
 * Update partial audio settings.
 */
export function updateAudioSettings(partial: Partial<{ voice: boolean; music: number; sfx: number }>): void {
  state = { ...state, ...partial };

  if (partial.sfx !== undefined) {
    setSfxVolume(state.sfx);
  }

  // Apply volume updates to currently playing music if it exists
  if (currentMusicHowl && state.music !== undefined) {
    currentMusicHowl.volume(state.music);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice manifest loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load voice manifest from URL (default /audio/voice/manifest.json).
 * Cached after first successful load. On 404 or network error, returns null
 * and caches that null so we don't retry.
 */
export async function loadVoiceManifest(url = '/audio/voice/manifest.json'): Promise<VoiceManifest | null> {
  // Already attempted; return cached result (even if null)
  if (voiceManifestFetchAttempted) {
    return voiceManifest;
  }

  voiceManifestFetchAttempted = true;

  if (!isOperating()) {
    voiceManifest = null;
    return null;
  }

  try {
    const resp = await fetch(assetUrl(url));
    if (!resp.ok) {
      voiceManifest = null;
      return null;
    }
    voiceManifest = await resp.json();
    return voiceManifest;
  } catch {
    voiceManifest = null;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice playback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a voice line exists for a pilot in the manifest.
 */
export function hasVoice(pilotDefId: string, lineKey: string): boolean {
  if (!voiceManifest) return false;
  const pilotVoices = voiceManifest.pilots[pilotDefId];
  return pilotVoices ? lineKey in pilotVoices : false;
}

/**
 * Play a voice line for a pilot. Returns false if disabled or missing.
 * Stops any currently playing voice first. Resolves when playback starts.
 * Ducks music while playing.
 */
export async function playVoice(pilotDefId: string, lineKey: string): Promise<boolean> {
  if (!state.voice || !voiceManifest) {
    return false;
  }

  const pilotVoices = voiceManifest.pilots[pilotDefId];
  if (!pilotVoices || !pilotVoices[lineKey]) {
    return false;
  }

  if (!isOperating()) {
    return false;
  }

  // Stop any currently playing voice
  stopVoice();

  const voiceUrl = pilotVoices[lineKey];

  // Duck music while voice plays
  duckMusic(true);

  return new Promise((resolve) => {
    try {
      currentVoiceHowl = new Howl({
        src: [assetUrl(voiceUrl)],
        html5: true,
        onend: () => {
          currentVoiceHowl = null;
          duckMusic(false);
        },
      });
      currentVoiceHowl.play();
      resolve(true);
    } catch {
      duckMusic(false);
      resolve(false);
    }
  });
}

/**
 * Stop any currently playing voice line.
 */
export function stopVoice(): void {
  if (currentVoiceHowl) {
    currentVoiceHowl.stop();
    currentVoiceHowl = null;
    duckMusic(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SFX synthesis (procedural, no asset files)
//
// The actual synth kit lives in sfx.ts (playSfx/playBattleSfx/playMapSfx,
// re-exported at the top of this file) so it can own its own SfxName union
// and share one AudioContext with the procedural music fallback below via
// getSfxAudioContext(). Volume is mirrored into sfx.ts via setSfxVolume()
// in initAudio/updateAudioSettings above, so playBattleSfx/playMapSfx
// respect the sfx setting even when the UI calls them directly.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Music playback with crossfade
// ─────────────────────────────────────────────────────────────────────────────

// Track which music tracks have been checked for existence (and result)
const musicExists = new Map<string, boolean>();

/**
 * Check if a music track exists at public/audio/music/<track>.mp3 via HEAD fetch.
 * Result is cached.
 */
async function musicTrackExists(track: string): Promise<boolean> {
  if (musicExists.has(track)) {
    return musicExists.get(track)!;
  }

  if (!isOperating()) {
    musicExists.set(track, false);
    return false;
  }

  try {
    const url = assetUrl(`/audio/music/${track}.mp3`);
    const resp = await fetch(url, { method: 'HEAD' });
    // Dev servers answer unknown paths with index.html + 200 (SPA fallback),
    // so require an audio content-type before believing the track exists.
    const type = resp.headers.get('content-type') ?? '';
    const exists = resp.ok && (type.startsWith('audio/') || type.startsWith('application/octet-stream'));
    musicExists.set(track, exists);
    return exists;
  } catch {
    musicExists.set(track, false);
    return false;
  }
}

/**
 * Play a looping music track with 800ms crossfade from current track.
 *
 * Prefers a real mp3 at public/audio/music/<track>.mp3 (HEAD-probed via
 * musicTrackExists). When it's absent -- or Howl fails to construct it --
 * falls back to the procedural WebAudio generator in procMusic.ts so music
 * still plays instead of silently no-op'ing. Never throws.
 */
export function playMusic(track: 'title' | 'map_space' | 'map_surface' | 'battle' | 'boss' | 'result'): void {
  // Fire the check asynchronously; don't block
  musicTrackExists(track).then((exists) => {
    if (!isOperating()) {
      return;
    }

    let newPlayer: any = null;

    // Preferred path: the real mp3, via Howler.
    if (exists) {
      {
        try {
          newPlayer = new Howl({
            src: [assetUrl(`/audio/music/${track}.mp3`)],
            loop: true,
            volume: 0, // start silent; faded in below like the fallback path
            html5: true,
          });
        } catch {
          newPlayer = null; // fall through to procedural below
        }
      }
    }

    // Fallback path: no mp3 (or Howl couldn't make one) -- synthesize.
    // Shares its AudioContext with sfx.ts's SFX kit (getSfxAudioContext)
    // so music and SFX mix through one real output.
    if (!newPlayer) {
      try {
        const ctx = getSfxAudioContext();
        if (!ctx) return;
        newPlayer = createProceduralMusic(ctx, track as MusicTrack);
      } catch {
        // AudioContext unavailable or construction failed; silent no-op,
        // matching the original "no track, no music" behavior.
        return;
      }
    }

    try {
      // Crossfade: fade out old track and fade in new one over 800ms
      const fadeDur = 0.8;
      const oldPlayer = currentMusicHowl;

      if (oldPlayer) {
        oldPlayer.fade(oldPlayer.volume(), 0, fadeDur * 1000);
        setTimeout(() => {
          oldPlayer.stop();
        }, fadeDur * 1000 + 50);
      }

      newPlayer.play();
      newPlayer.fade(0, state.music, fadeDur * 1000);

      currentMusicHowl = newPlayer;
      currentMusicIsProcedural = !!newPlayer.isProcedural;
    } catch {
      // Error starting playback; silent no-op
    }
  });
}

/**
 * Stop any currently playing music track (real or procedural).
 */
export function stopMusic(): void {
  if (currentMusicHowl) {
    currentMusicHowl.stop();
    currentMusicHowl = null;
  }
  currentMusicIsProcedural = false;
}

/**
 * True when the currently playing music is the procedural WebAudio
 * fallback (procMusic.ts) rather than a real mp3. Always false in Node
 * (no AudioContext) or before any playMusic() call resolves. For
 * debugging/telemetry.
 */
export function isProceduralMusicActive(): boolean {
  return currentMusicIsProcedural;
}

// ─────────────────────────────────────────────────────────────────────────────
// Music ducking
// ─────────────────────────────────────────────────────────────────────────────

let isDucked = false;

/**
 * Duck (reduce) music volume by ~60% while voice plays or a cut-in occurs.
 */
export function duckMusic(on: boolean): void {
  if (!currentMusicHowl || !isOperating()) {
    isDucked = on;
    return;
  }

  isDucked = on;
  const targetVolume = on ? state.music * 0.4 : state.music;
  const fadeDur = 200; // 200ms fade

  currentMusicHowl.fade(currentMusicHowl.volume(), targetVolume, fadeDur);
}

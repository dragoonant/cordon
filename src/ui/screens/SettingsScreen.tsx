import React from 'react';
import { useStore } from '@ui/store';
import { Button, Modal, Panel } from '@ui/components';
import { persist, exportSave, importSave } from '@save/index';
import type { Settings } from '@sim/types';

const SPEED_OPTIONS: Settings['battleSpeed'][] = ['full', 'fast', 'results_only'];

export function SettingsScreen() {
  const save = useStore((s) => s.save);
  const run = useStore((s) => s.run);
  const updateSettings = useStore((s) => s.updateSettings);
  const abandonRun = useStore((s) => s.abandonRun);
  const back = useStore((s) => s.back);
  const go = useStore((s) => s.go);

  const [confirmAbandon, setConfirmAbandon] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState<string | null>(null);
  const [importText, setImportText] = React.useState('');
  const [importStatus, setImportStatus] = React.useState<string | null>(null);

  if (!save) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Panel title="Settings">
          <div className="muted mono">No save loaded yet.</div>
        </Panel>
      </div>
    );
  }

  const settings = save.settings;

  async function copySave() {
    try {
      await navigator.clipboard.writeText(exportSave(save!));
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch (e) {
      setCopyStatus('copy failed');
    }
  }

  async function doImport() {
    try {
      const next = importSave(importText);
      await persist(next);
      // No dedicated "import" store action exists; reloading re-runs boot(),
      // which reads the freshly persisted save from IndexedDB. Documented in report.
      location.reload();
    } catch (e) {
      setImportStatus(String((e as Error)?.message ?? e));
    }
  }

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 32, boxSizing: 'border-box', overflow: 'auto' }}>
      <div className="col gap-m" style={{ maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <h2 className="mono title-glow" style={{ color: 'var(--amber)', letterSpacing: '0.15em' }}>
          SETTINGS
        </h2>

        <Panel title="Battle">
          <div className="col gap-m">
            <div className="col gap-s">
              <span className="mono muted" style={{ fontSize: 11 }}>
                BATTLE SPEED
              </span>
              <div className="row gap-s">
                {SPEED_OPTIONS.map((opt) => (
                  <Button
                    key={opt}
                    small
                    variant={settings.battleSpeed === opt ? 'primary' : 'ghost'}
                    onClick={() => updateSettings({ battleSpeed: opt })}
                  >
                    {opt.replace('_', ' ')}
                  </Button>
                ))}
              </div>
            </div>
            <ToggleRow
              label="Voice lines"
              value={settings.voice}
              onChange={(v) => updateSettings({ voice: v })}
            />
            <ToggleRow
              label="Auto-pause on contact"
              value={settings.autoPauseOnContact}
              onChange={(v) => updateSettings({ autoPauseOnContact: v })}
            />
          </div>
        </Panel>

        <Panel title="Audio">
          <div className="col gap-m">
            <SliderRow label="Music" value={settings.music} onChange={(v) => updateSettings({ music: v })} />
            <SliderRow label="SFX" value={settings.sfx} onChange={(v) => updateSettings({ sfx: v })} />
          </div>
        </Panel>

        <Panel title="Save Data">
          <div className="col gap-m">
            <div className="row gap-s" style={{ alignItems: 'center' }}>
              <Button variant="ghost" onClick={copySave}>
                Export Save (copy to clipboard)
              </Button>
              {copyStatus && <span className="mono muted">{copyStatus}</span>}
            </div>
            <div className="col gap-s">
              <span className="mono muted" style={{ fontSize: 11 }}>
                IMPORT SAVE JSON
              </span>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                className="mono"
                style={{
                  width: '100%',
                  resize: 'vertical',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 4,
                  color: 'var(--fg)',
                  padding: 8,
                  fontSize: 11,
                }}
              />
              <div className="row gap-s" style={{ alignItems: 'center' }}>
                <Button variant="ghost" disabled={!importText.trim()} onClick={doImport}>
                  Import &amp; Reload
                </Button>
                {importStatus && <span className="mono" style={{ color: 'var(--danger)' }}>{importStatus}</span>}
              </div>
            </div>
          </div>
        </Panel>

        {run && run.status === 'active' && (
          <Panel title="Danger Zone" accent="neutral">
            <Button variant="danger" onClick={() => setConfirmAbandon(true)}>
              Abandon Run
            </Button>
          </Panel>
        )}

        <div className="row gap-s">
          <Button variant="ghost" onClick={() => (run ? back() : go('title'))}>
            Back
          </Button>
        </div>
      </div>

      <Modal open={confirmAbandon} title="Abandon Run?" onClose={() => setConfirmAbandon(false)} width={380}>
        <div className="col gap-m">
          <div className="mono" style={{ fontSize: 13 }}>
            This ends the current run as a loss. Surviving pilots return to the pool, but this run&rsquo;s progress is gone.
          </div>
          <div className="row gap-s">
            <Button
              variant="danger"
              onClick={() => {
                setConfirmAbandon(false);
                void abandonRun();
              }}
            >
              Abandon
            </Button>
            <Button variant="ghost" onClick={() => setConfirmAbandon(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="mono" style={{ fontSize: 12 }}>
        {label}
      </span>
      <Button small variant={value ? 'primary' : 'ghost'} onClick={() => onChange(!value)}>
        {value ? 'On' : 'Off'}
      </Button>
    </div>
  );
}

function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="col gap-s">
      <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 12 }}>
        <span>{label}</span>
        <span className="muted">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--amber)' }}
      />
    </div>
  );
}

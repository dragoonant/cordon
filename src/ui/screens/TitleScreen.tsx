import React from 'react';
import { useStore } from '@ui/store';
import { Button, Panel, useData } from '@ui/components';
import { ascensionModifiers, currentNode } from '@sim/run';

export function TitleScreen() {
  const data = useData();
  const save = useStore((s) => s.save);
  const run = useStore((s) => s.run);
  const runEndUnlocked = useStore((s) => s.runEndUnlocked);
  const startNewRun = useStore((s) => s.startNewRun);
  const continueRun = useStore((s) => s.continueRun);
  const go = useStore((s) => s.go);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  if (!data || !save) {
    return (
      <Centered>
        <Panel title="Uplink">
          <div className="mono muted">No connection to game data yet.</div>
        </Panel>
      </Centered>
    );
  }

  const unlocks = save.unlocks;
  const canContinue = !!run && run.status === 'active';
  const ascensionMax = unlocks.ascensionMax;

  let progress: string | null = null;
  if (canContinue && run) {
    const node = currentNode(run);
    const sector = run.sectors[run.sectorIndex];
    const maxCol = sector ? Math.max(...sector.nodes.map((n) => n.col)) : node.col;
    progress = `${sector?.name ?? `Sector ${run.sectorIndex + 1}`} · Node ${node.col}/${maxCol} · Turn ${run.turn}`;
  }

  const totalUnlocked = unlocks.pilots.length + unlocks.frames.length + unlocks.weapons.length + unlocks.systems.length;

  function newRunClicked() {
    if (ascensionMax > 0) setPickerOpen(true);
    else void startNewRun(0);
  }

  return (
    <div className="col" style={{ height: '100%', width: '100%', padding: 36, boxSizing: 'border-box' }}>
      <div className="col grow" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="col gap-l" style={{ alignItems: 'center', width: 520, maxWidth: '90vw' }}>
          <div className="col gap-s" style={{ alignItems: 'center' }}>
            <h1
              className="mono title-glow"
              style={{ fontSize: 64, letterSpacing: '0.35em', fontWeight: 300, margin: 0, color: 'var(--amber)' }}
            >
              CORDON
            </h1>
            <div className="mono muted" style={{ fontSize: 13, letterSpacing: '0.15em' }}>
              a blockade-runner&rsquo;s war
            </div>
          </div>

          {runEndUnlocked.length > 0 && <NewUnlocksPanel ids={runEndUnlocked} data={data} />}

          {pickerOpen ? (
            <AscensionPicker
              max={ascensionMax}
              onPick={(level) => {
                setPickerOpen(false);
                void startNewRun(level);
              }}
              onCancel={() => setPickerOpen(false)}
            />
          ) : (
            <div className="col gap-m" style={{ width: '100%' }}>
              <Button variant="primary" onClick={newRunClicked} style={{ width: '100%' }}>
                New Run
              </Button>
              {canContinue && (
                <Button variant="ghost" onClick={continueRun} style={{ width: '100%' }}>
                  Continue{progress ? ` — ${progress}` : ''}
                </Button>
              )}
              <Button variant="ghost" onClick={() => go('settings')} style={{ width: '100%' }}>
                Settings
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="row mono muted" style={{ justifyContent: 'center', gap: 24, fontSize: 11 }}>
        <span>RUNS {unlocks.runsAttempted} ATTEMPTED / {unlocks.runsWon} WON</span>
        <span>PILOTS LOST {unlocks.totalPilotDeaths}</span>
        <span>UNLOCKED {totalUnlocked}</span>
      </div>
    </div>
  );
}

function AscensionPicker({
  max,
  onPick,
  onCancel,
}: {
  max: number;
  onPick: (level: number) => void;
  onCancel: () => void;
}) {
  const [level, setLevel] = React.useState(0);
  const mods = ascensionModifiers(level);
  const levels = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <Panel title="Ascension" accent="relay" style={{ width: '100%' }}>
      <div className="col gap-m">
        <div className="row gap-s" style={{ flexWrap: 'wrap' }}>
          {levels.map((l) => (
            <Button key={l} small variant={l === level ? 'primary' : 'ghost'} onClick={() => setLevel(l)}>
              {l === 0 ? 'None' : `Lv ${l}`}
            </Button>
          ))}
        </div>
        <div className="col gap-s">
          {mods.length === 0 && <div className="muted mono" style={{ fontSize: 12 }}>No modifiers at this level.</div>}
          {mods.map((m, i) => (
            <div key={i} className="col" style={{ fontSize: 12 }}>
              <span className="mono" style={{ color: 'var(--amber)' }}>
                {m.label}
              </span>
              <span className="muted">{m.description}</span>
            </div>
          ))}
        </div>
        <div className="row gap-s">
          <Button variant="primary" onClick={() => onPick(level)}>
            Launch
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function NewUnlocksPanel({ ids, data }: { ids: string[]; data: NonNullable<ReturnType<typeof useData>> }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  const names = ids.map((id) => data.pilots[id]?.name ?? data.frames[id]?.name ?? data.weapons[id]?.name ?? data.systems[id]?.name ?? id);
  return (
    <Panel title="New Unlocks" accent="relay" style={{ width: '100%', cursor: 'pointer' }}>
      <div onClick={() => setDismissed(true)} className="col gap-s">
        {names.map((n, i) => (
          <div key={i} className="mono" style={{ fontSize: 12, color: 'var(--amber)' }}>
            {n}
          </div>
        ))}
        <div className="muted mono" style={{ fontSize: 10 }}>
          click to dismiss
        </div>
      </div>
    </Panel>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 420 }}>{children}</div>
    </div>
  );
}

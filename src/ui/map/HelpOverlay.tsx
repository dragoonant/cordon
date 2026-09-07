import React from 'react';
import { Kbd, Modal } from '@ui/components';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KEYS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['1 / 2 / 3', 'Speed 1x / 2x / 4x'],
  ['Tab', 'Cycle selected squadron'],
  ['R', 'Recall selected squadron'],
  ['Escape', 'Deselect'],
  ['H', 'Toggle this help'],
];

export function HelpOverlay({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="HOW TO PLAY" width={460}>
      <div className="col gap-s">
        {KEYS.map(([key, desc]) => (
          <div key={key} className="row gap-s" style={{ justifyContent: 'space-between' }}>
            <Kbd>{key}</Kbd>
            <span className="muted">{desc}</span>
          </div>
        ))}
      </div>
      <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Front row absorbs hits and fights close; back row fires from range or heals — match your loadout to the row.</li>
        <li>
          Nerve fuels Callouts, pre-battle and on the map. It regenerates +1 every 20s deployed, +5 when an
          objective completes, +8 to survivors when a squadmate dies, and +3 to winners — hover any Nerve bar for
          the details.
        </li>
        <li>Mobility fit matters: space frames are sluggish on the ground, ground frames are clumsy in space.</li>
        <li>Pilot death is permanent for this run — protect people, not just mechs.</li>
        <li>Pause is free — take your time, nothing moves while you think.</li>
        <li>Contact with an enemy squad is a battle. There's no talking your way out.</li>
        <li>Always check the Forecast before you commit — Callouts can change the odds.</li>
        <li>Watch your fuel — a stranded squad is a dead squad.</li>
      </ul>
    </Modal>
  );
}

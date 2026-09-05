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
        <li>Pause is free — take your time, nothing moves while you think.</li>
        <li>Contact with an enemy squad is a battle. There's no talking your way out.</li>
        <li>Always check the Forecast before you commit — Callouts can change the odds.</li>
        <li>Rescues need a squad inside the ring with no enemies nearby.</li>
        <li>Watch your fuel — a stranded squad is a dead squad.</li>
      </ul>
    </Modal>
  );
}

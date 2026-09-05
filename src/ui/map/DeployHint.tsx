import React from 'react';

/** Centered hint shown while world.phase === 'deploy', pointing at the SQUADRONS panel. */
export function DeployHint() {
  return (
    <div className="deploy-hint">
      <div className="deploy-hint-arrow">{'←'}</div>
      <div>Deploy your squadrons from the Lantern</div>
    </div>
  );
}

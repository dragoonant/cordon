import React from 'react';
import { useStore } from '@ui/store';

interface State {
  error: Error | null;
}

/**
 * Last line of defense: a render/cleanup crash in one screen must never blank
 * the whole game. Shows the error and offers a route back to a safe screen.
 * The run state lives in the store, so nothing is lost.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[cordon] screen crashed', error, info.componentStack);
  }

  private recover = (screen: 'title' | 'node_map') => {
    const s = useStore.getState();
    useStore.setState({ world: null, map: null, battle: null, forecast: null, pendingCallouts: [] });
    if (screen === 'node_map' && s.run && s.run.status === 'active') s.go('node_map');
    else s.go('title');
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;
    const hasRun = !!useStore.getState().run;
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <div style={{ maxWidth: 640, background: 'rgba(12,14,20,0.95)', border: '1px solid #e5484d', padding: 20, fontFamily: 'Consolas, monospace' }}>
          <div style={{ color: '#e5484d', letterSpacing: '0.2em', marginBottom: 8 }}>UPLINK FAULT</div>
          <div style={{ color: '#e8e4d8', marginBottom: 12, fontSize: 13 }}>A screen crashed. Your run is intact.</div>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#8a8f99', fontSize: 11, maxHeight: 160, overflow: 'auto' }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {hasRun && (
              <button onClick={() => this.recover('node_map')} style={btn(true)}>
                BACK TO SECTOR MAP
              </button>
            )}
            <button onClick={() => this.recover('title')} style={btn(false)}>
              TITLE
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? '#ffa53c' : 'transparent',
    color: primary ? '#0b0d12' : '#e8e4d8',
    border: primary ? 'none' : '1px solid #8a8f99',
    padding: '8px 14px',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    cursor: 'pointer',
  };
}

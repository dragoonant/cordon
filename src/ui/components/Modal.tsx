import React from 'react';

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, width = 420 }: ModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 8000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(4,5,8,0.55)',
        backdropFilter: 'blur(4px)',
        animation: 'cordon-slide-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--panel-solid)',
          border: '1px solid rgba(255,165,60,0.4)',
          borderRadius: 6,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        }}
      >
        {title && (
          <div
            className="mono"
            style={{
              padding: '12px 16px',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--amber)',
              borderBottom: '1px solid rgba(255,165,60,0.2)',
            }}
          >
            {title}
          </div>
        )}
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

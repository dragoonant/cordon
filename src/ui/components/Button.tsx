import React from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  small?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

const BASE: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 600,
  border: '1px solid transparent',
  borderRadius: 3,
  cursor: 'pointer',
  transition: 'filter 0.12s ease, box-shadow 0.12s ease, transform 0.05s ease',
  userSelect: 'none',
};

function variantStyle(variant: ButtonVariant, disabled: boolean): React.CSSProperties {
  if (variant === 'primary') {
    return {
      background: disabled ? 'rgba(255,165,60,0.25)' : 'var(--amber)',
      color: disabled ? '#7a5c30' : '#1a0f00',
      borderColor: 'rgba(255,165,60,0.8)',
    };
  }
  if (variant === 'danger') {
    return {
      background: disabled ? 'rgba(229,72,77,0.15)' : 'rgba(229,72,77,0.12)',
      color: disabled ? '#7a3c3e' : 'var(--danger)',
      borderColor: disabled ? 'rgba(229,72,77,0.25)' : 'rgba(229,72,77,0.7)',
    };
  }
  // ghost
  return {
    background: 'transparent',
    color: disabled ? 'var(--muted)' : 'var(--fg)',
    borderColor: disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.25)',
  };
}

export function Button({ children, onClick, variant = 'ghost', disabled, small, title, style }: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const vs = variantStyle(variant, !!disabled);
  const glow =
    hover && !disabled
      ? variant === 'primary'
        ? '0 0 12px rgba(255,165,60,0.6)'
        : variant === 'danger'
          ? '0 0 12px rgba(229,72,77,0.5)'
          : '0 0 8px rgba(255,255,255,0.2)'
      : 'none';
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...BASE,
        ...vs,
        padding: small ? '4px 10px' : '9px 18px',
        fontSize: small ? 11 : 13,
        opacity: disabled ? 0.5 : 1,
        boxShadow: glow,
        filter: disabled ? 'grayscale(0.4)' : 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

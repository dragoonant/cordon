import React from 'react';

export interface DropdownOption {
  value: string;
  label: React.ReactNode;
  /** Visually flagged (e.g. "over budget") without being unselectable. */
  warn?: boolean;
}

export interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  placeholder?: string;
}

/**
 * Small custom dropdown standing in for a native `<select>`. Native `<option>`
 * elements on Windows/Chrome render with an OS-controlled popup that mostly
 * ignores our dark theme's `color`, leaving light-on-light text that reads as
 * "grayed out and unselectable" — this renders the list ourselves so every
 * row is legibly styled, and an option can be flagged (`warn`) while staying
 * clickable, which a real `disabled` `<option>` cannot do.
 */
export function Dropdown({ value, options, onChange, placeholder = '— select —' }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="cordon-dropdown">
      <button type="button" className="mono cordon-dropdown-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="cordon-dropdown-trigger-label">{current ? current.label : placeholder}</span>
        <span aria-hidden style={{ opacity: 0.6 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="cordon-dropdown-list mono" role="listbox">
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cordon-dropdown-option${o.value === value ? ' selected' : ''}${o.warn ? ' warn' : ''}`}
              onClick={() => {
                if (o.value !== value) onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import launchboxPlatformsData from './launchboxPlatforms.json';

export interface LaunchBoxPlatform {
  id: number;
  name: string;
  imageUrl: string | null;
}

const RAW_PLATFORMS = (launchboxPlatformsData as { platforms: LaunchBoxPlatform[] }).platforms;

export const LAUNCHBOX_PLATFORMS: LaunchBoxPlatform[] = [...RAW_PLATFORMS].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const MAX_OPTIONS = 100;

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(value: string, query: string) {
  const normalized = normalize(value);
  const term = normalize(query);
  if (!term) return true;
  return normalized.includes(term);
}

export default function LaunchboxPlatformSelect({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const options = useMemo(
    () => LAUNCHBOX_PLATFORMS.filter((platform) => matches(platform.name, value)),
    [value],
  );

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[data-highlighted="true"]');
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const selectOption = (option: LaunchBoxPlatform) => {
    onChange(option.name);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) {
        setOpen(true);
        setHighlight(0);
      } else {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setHighlight((current) => {
          const next = current + delta;
          if (next < 0) return options.length - 1;
          if (next >= options.length) return 0;
          return next;
        });
      }
      event.preventDefault();
      return;
    }
    if (open && event.key === 'Enter') {
      const option = options[Math.min(highlight, options.length - 1)];
      if (option) selectOption(option);
      event.preventDefault();
      return;
    }
    if (open && event.key === 'Escape') {
      setOpen(false);
      event.preventDefault();
    }
  };

  return (
    <div className="platform-select">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className="platform-select-clear"
          aria-label="Limpiar plataforma"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            setOpen(false);
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      ) : null}
      {open && options.length > 0 && (
        <ul className="platform-select-list" ref={listRef} role="listbox">
          {options.slice(0, MAX_OPTIONS).map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                data-highlighted={index === highlight}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => selectOption(option)}
              >
                {option.imageUrl ? <img src={option.imageUrl} alt="" loading="lazy" /> : <i />}
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

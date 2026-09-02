/**
 * SearchInput — reusable search input with icon and debounce.
 *
 * §8 My Tickets screen: search input for ticket number or summary.
 * Uses a 300ms debounce (Q1 decision) to avoid excessive API calls
 * while the user types.
 *
 * Reuses Field.module.css for consistent input styling.
 */

import { useState, useEffect, useRef } from "react";
import styles from "./SearchInput.module.css";

interface SearchInputProps {
  /** Current controlled value. */
  value: string;
  /** Called when the debounced value changes (after 300ms of no typing). */
  onSearch: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Unique id for the input element. */
  id?: string;
}

const DEBOUNCE_MS = 300;

export default function SearchInput({
  value,
  onSearch,
  placeholder = "Search by ticket number or summary…",
  id,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if the user has typed since last sync from props
  const lastSyncedValue = useRef(value);

  // Sync from parent when value changes externally (e.g. Clear Filters)
  useEffect(() => {
    if (value !== lastSyncedValue.current) {
      setLocalValue(value);
      lastSyncedValue.current = value;
    }
  }, [value]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value;
    setLocalValue(newValue);

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      lastSyncedValue.current = newValue;
      onSearch(newValue);
    }, DEBOUNCE_MS);
  }

  return (
    <div className={styles.searchInput}>
      {/* §10: icon never replaces required text — sits alongside */}
      <span className={styles.icon} aria-hidden="true">
        🔍
      </span>
      <input
        id={id}
        type="text"
        className={styles.input}
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

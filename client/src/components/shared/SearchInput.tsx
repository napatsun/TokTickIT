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
  /**
   * Bump this to force-clear the input and cancel any pending debounce — used
   * by a page's "Clear filters" action.
   *
   * Needed because the parent's `value` is the *debounced* term: while a term is
   * still within the 300ms debounce window the parent value is still "", so the
   * [value] sync effect below cannot tell that a search is pending and a stale
   * term would re-apply after the user has already cleared the filters.
   */
  resetSignal?: number;
}

const DEBOUNCE_MS = 300;

export default function SearchInput({
  value,
  onSearch,
  placeholder = "Search by ticket number or summary…",
  id,
  resetSignal,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if the user has typed since last sync from props
  const lastSyncedValue = useRef(value);

  // Sync from parent when value changes externally (e.g. Clear Filters)
  useEffect(() => {
    if (value !== lastSyncedValue.current) {
      // Cancel any pending debounce first. Without this, a parent reset that
      // lands inside the 300ms window is silently undone when the stale timer
      // fires and re-emits the old term — the field clears and then the old
      // search reappears a moment later.
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setLocalValue(value);
      lastSyncedValue.current = value;
    }
  }, [value]);

  // External reset ("Clear filters"): cancel any pending debounce and drop the
  // local text, so a term typed just before the clear can never re-apply.
  useEffect(() => {
    if (resetSignal === undefined) return;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setLocalValue(value);
    lastSyncedValue.current = value;
    // Keyed on resetSignal only: `value` is read at the moment the reset is
    // requested rather than tracked as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

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

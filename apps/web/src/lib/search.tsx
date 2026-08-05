'use client';

import { createContext, useContext, useMemo, useState } from 'react';

interface SearchState {
  query: string;
  setQuery: (value: string) => void;
}

const SearchContext = createContext<SearchState | null>(null);

/** Lets the header search box in the shell drive filtering inside a page. */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const ctx = useContext(SearchContext);
  // Pages rendered outside the shell (the exam runner) simply have no search.
  return ctx ?? { query: '', setQuery: () => undefined };
}

export { SearchContext };

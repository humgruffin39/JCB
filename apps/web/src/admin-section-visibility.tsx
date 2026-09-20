import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the section a component sits in is the one on screen.
 *
 * Every section stays mounted so that changing tab is a change of visibility
 * and nothing else: the rows are already there, so there is nothing to wait
 * for and nothing to fade in. What the hidden ones must not do is keep
 * polling, so the pollers read this and stand down until their section is
 * shown again.
 */
const SectionVisibilityContext = createContext(true);

export function AdminSectionVisibility({
  isActive,
  children,
}: {
  readonly isActive: boolean;
  readonly children: ReactNode;
}) {
  return (
    <SectionVisibilityContext.Provider value={isActive}>
      {children}
    </SectionVisibilityContext.Provider>
  );
}

export function useIsSectionActive(): boolean {
  return useContext(SectionVisibilityContext);
}

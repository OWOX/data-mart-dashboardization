import { createContext, useContext } from 'react';

/** True inside a read-only editor: pickers and inputs render disabled and ignore clicks and keys. */
export const ReadOnly = createContext(false);
export const useReadOnly = () => useContext(ReadOnly);

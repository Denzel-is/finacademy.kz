import { createContext, useContext } from "react";
import type { User } from "../shared/types";
type Context = {
  user: User;
  notify: (text: string) => void;
  navigate: (path: string) => void;
  settings: Record<string, string>;
  updateSettings: (value: Record<string, string>) => void;
};
export const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);

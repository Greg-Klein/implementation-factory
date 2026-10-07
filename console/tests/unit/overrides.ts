import { defined } from "../../lib/defined";

/** What one test changes in a fixture. A property given as undefined is taken away. */
export type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

/** A fixture with the overrides of one test laid over it. */
export function overridden<T extends object>(base: T, overrides: Overrides<T>): T {
  return defined({ ...base, ...overrides }) as T;
}

/**
 * The properties that hold a value. One left undefined is dropped, so a value
 * that is not there is an absent property and never a property set to nothing:
 * what reads the object with `in`, a spread or a strict comparison sees the same
 * thing as what reads it once written as JSON.
 */
export function defined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, held]) => held !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

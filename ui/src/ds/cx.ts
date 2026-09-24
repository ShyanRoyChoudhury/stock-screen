export function cx(...a: Array<string | false | null | undefined>): string {
  return a.filter(Boolean).join(' ')
}

export function crossSpreadDisplayName(name: string): string {
  return name.replaceAll('代理', '').trim()
}

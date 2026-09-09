export class RetryablePromiseCache<Key, Value> {
  private readonly entries = new Map<Key, Promise<Value>>()

  get(key: Key, load: () => Promise<Value>): Promise<Value> {
    const cached = this.entries.get(key)
    if (cached) return cached

    const pending = load()
    this.entries.set(key, pending)
    void pending.catch(() => {
      if (this.entries.get(key) === pending) {
        this.entries.delete(key)
      }
    })
    return pending
  }
}

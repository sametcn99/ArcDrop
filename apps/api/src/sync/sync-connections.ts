/**
 * Per-user connection registry for the sync gateway — the raw-`ws`
 * equivalent of a room map (plan D4: "server keeps a per-user room").
 * `ws` has no room concept, so the gateway tracks them here: events are
 * fanned out ONLY to the sockets registered under the owning user's id,
 * which is what makes cross-user isolation structural rather than a
 * convention. A generic client type keeps this unit-testable without
 * sockets (plain objects stand in).
 */
export class SyncConnections<Client> {
  private readonly byUser = new Map<string, Set<Client>>();

  /** Registers a client under its user (idempotent — a Set per user). */
  add(userId: string, client: Client): void {
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set<Client>();
      this.byUser.set(userId, set);
    }
    set.add(client);
  }

  /** Drops a client (its own socket's `close` event drives this). */
  remove(userId: string, client: Client): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.byUser.delete(userId);
  }

  /** The live connections of one user — empty when none. */
  connectionsOf(userId: string): readonly Client[] {
    const set = this.byUser.get(userId);
    return set ? [...set] : [];
  }

  has(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  /** Every connection regardless of owner — the heartbeat sweep's input. */
  all(): readonly Client[] {
    const all: Client[] = [];
    for (const set of this.byUser.values()) all.push(...set);
    return all;
  }

  count(): number {
    return this.all().length;
  }

  clear(): void {
    this.byUser.clear();
  }
}

/**
 * Global Variable Registry (GlobalVars)
 * 
 * The single source of truth for persistent state across protocol steps.
 * This is injected into the Sandbox environment so the Main Architect
 * can store and retrieve data between executions.
 */
export class GlobalVars {
  private store: Map<string, any> = new Map();

  /**
   * Sets a value in the registry.
   */
  set(key: string, value: any): void {
    this.store.set(key, value);
  }

  /**
   * Retrieves a value from the registry.
   */
  get(key: string): any {
    return this.store.get(key);
  }

  /**
   * Returns all stored variables as a record.
   */
  getAll(): Record<string, any> {
    return Object.fromEntries(this.store.entries());
  }

  /**
   * Clears the registry.
   */
  clear(): void {
    this.store.clear();
  }
}

// Export a singleton instance
export const globalVars = new GlobalVars();

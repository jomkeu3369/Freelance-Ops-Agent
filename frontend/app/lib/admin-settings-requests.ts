/** Serialize settings reads against mutations and account changes, including auth recovery. */
export class AdminSettingsRequests {
  private revision = 0;
  private scope: string | null = null;
  private mutation: number | null = null;
  setScope(scope: string | null) {
    if (this.scope === scope) return false;
    this.scope = scope; this.revision += 1; this.mutation = null; return true;
  }
  beginRead(): number | null {
    if (!this.scope || this.mutation !== null) return null;
    return ++this.revision;
  }
  acceptsRead(token: number): boolean { return this.mutation === null && token === this.revision; }
  beginMutation(): number | null {
    if (!this.scope || this.mutation !== null) return null;
    this.mutation = ++this.revision;
    return this.mutation;
  }
  acceptsMutation(token: number): boolean { return this.mutation === token && token === this.revision; }
  finishMutation(token: number) { if (this.acceptsMutation(token)) this.mutation = null; }
}

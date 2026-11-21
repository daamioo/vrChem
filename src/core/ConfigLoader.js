/**
 * Loads the JSON config set. The `source` is injectable so the same loader works in the
 * browser (fetch) and in Node tests (fs) - see test/ and tools/.
 */
export class ConfigLoader {
  static FILES = ['settings', 'chemicals', 'reactions', 'equipment', 'lab'];

  /** @param {(name:string)=>Promise<object>} source */
  constructor(source) { this.source = source; }

  static fromUrl(baseUrl = './config/') {
    return new ConfigLoader(async (name) => {
      const res = await fetch(`${baseUrl}${name}.json`);
      if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
      return res.json();
    });
  }

  async loadAll() {
    const entries = await Promise.all(ConfigLoader.FILES.map(async (n) => [n, await this.source(n)]));
    return Object.fromEntries(entries);
  }
}

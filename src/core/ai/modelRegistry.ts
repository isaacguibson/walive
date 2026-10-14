import type { ManualModel, ModelInfo } from '@shared/ai/types';
import type { JsonFile } from './jsonFile';

export type ModelCache = Record<string, ModelInfo[]>;

export function parseModelCache(value: unknown): ModelCache {
  const cache: ModelCache = {};
  if (typeof value === 'object' && value !== null) {
    for (const [providerId, models] of Object.entries(value)) {
      if (Array.isArray(models)) {
        cache[providerId] = models.filter((model): model is ModelInfo => typeof model === 'object' && model !== null && typeof (model as ModelInfo).id === 'string');
      }
    }
  }
  return cache;
}

/** A model the user declared: its capabilities are what they stated, nothing more. */
export function manualModelInfo(providerId: string, model: ManualModel): ModelInfo {
  return {
    providerId,
    id: model.id,
    displayName: model.displayName,
    source: 'manual',
    capabilities: { image: model.image ? 'yes' : 'no', tools: model.tools ? 'yes' : 'no', streaming: 'unknown', efforts: model.efforts, contextWindow: null },
    available: true
  };
}

/** Normalized registry of the models of every provider; discovered ones are cached for offline use. */
export class AIModelRegistry {
  constructor(private readonly file: JsonFile<ModelCache>) {}

  async list(providerId: string, manual: ManualModel[], usable: boolean): Promise<ModelInfo[]> {
    const discovered = (await this.file.read())[providerId] ?? [];
    const declared = manual.map((model) => manualModelInfo(providerId, model));
    const declaredIds = new Set(declared.map((model) => model.id));
    return [...declared, ...discovered.filter((model) => !declaredIds.has(model.id))].map((model) => ({ ...model, available: usable }));
  }

  async store(providerId: string, models: ModelInfo[]): Promise<void> {
    await this.file.write({ ...(await this.file.read()), [providerId]: models });
  }

  async forget(providerId: string): Promise<void> {
    const { [providerId]: _removed, ...rest } = await this.file.read();
    await this.file.write(rest);
  }
}

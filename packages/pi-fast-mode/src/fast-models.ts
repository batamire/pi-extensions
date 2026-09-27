type ModelKeyParts = {
  provider: string
  id: string
}

const OPENAI_PROVIDERS = new Set(["openai", "openai-codex"])

export function isOpenAIProvider(provider: string): boolean {
  return OPENAI_PROVIDERS.has(provider)
}

export function getAvailableFastModels(models: ModelKeyParts[]): string[] {
  return models
    .filter((model) => isOpenAIProvider(model.provider))
    .map((model) => `${model.provider}/${model.id}`)
    .toSorted()
}

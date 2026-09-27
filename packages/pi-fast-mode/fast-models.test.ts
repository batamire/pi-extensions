import assert from "node:assert/strict"
import test from "node:test"
import { getAvailableFastModels, isOpenAIProvider } from "./src/fast-models.ts"

test("lists available OpenAI provider models and sorts them", () => {
  const models = getAvailableFastModels([
    { provider: "openai", id: "gpt-next" },
    { provider: "openai", id: "gpt-6-luna" },
    { provider: "openai-codex", id: "gpt-6-luna" },
    { provider: "other", id: "gpt-6-luna" },
  ])

  assert.deepEqual(models, [
    "openai-codex/gpt-6-luna",
    "openai/gpt-6-luna",
    "openai/gpt-next",
  ])
})

test("limits Fast Mode requests to OpenAI providers", () => {
  assert.equal(isOpenAIProvider("openai"), true)
  assert.equal(isOpenAIProvider("openai-codex"), true)
  assert.equal(isOpenAIProvider("other"), false)
})

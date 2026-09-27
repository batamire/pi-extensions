import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent"
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import { getAvailableFastModels, isOpenAIProvider } from "./fast-models.js"
import { registerTps } from "./tps.js"

type FastConfig = {
  models: string[]
  tpsEnabled: boolean
}

type Model = NonNullable<ExtensionContext["model"]>
const CONFIG_PATH = join(getAgentDir(), "extensions", "pi-fast-mode.json")
const DEFAULT_SERVICE_TIER = "priority"
function formatFooterTokens(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function modelKey(model: Model): string {
  return `${model.provider}/${model.id}`
}

function parseConfig(value: unknown): FastConfig {
  if (
    !isRecord(value) ||
    !Array.isArray(value["models"]) ||
    value["models"].some((model) => typeof model !== "string")
  ) {
    throw new Error('expected { "models": string[] }')
  }

  const tpsEnabled = value["tpsEnabled"]
  if (tpsEnabled !== undefined && typeof tpsEnabled !== "boolean") {
    throw new Error('expected "tpsEnabled" to be boolean')
  }

  return {
    models: [...new Set(value["models"])],
    tpsEnabled: tpsEnabled ?? true,
  }
}

function readConfig(): FastConfig {
  let content: string
  try {
    content = readFileSync(CONFIG_PATH, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { models: [], tpsEnabled: true }
    }
    throw error
  }

  try {
    return parseConfig(JSON.parse(content))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid ${CONFIG_PATH}: ${reason}`, { cause: error })
  }
}

function writeConfig(models: Set<string>, tpsEnabled: boolean): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(
    CONFIG_PATH,
    `${JSON.stringify(
      { models: [...models].toSorted(), tpsEnabled },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

function isFastModel(
  model: Model | undefined,
  enabledModels: Set<string>,
): boolean {
  if (!model || !isOpenAIProvider(model.provider)) return false
  return enabledModels.has(modelKey(model))
}

function notify(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  message: string,
  type: "info" | "error" = "info",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

export default function piFastExtension(pi: ExtensionAPI): void {
  let enabledModels = new Set<string>()
  let tpsEnabled = true
  const setTpsEnabled = registerTps(pi, (enabled) => {
    writeConfig(enabledModels, enabled)
    tpsEnabled = enabled
  })

  function updateFastFooter(ctx: ExtensionContext): void {
    if (
      !ctx.model ||
      ctx.mode !== "tui" ||
      !isFastModel(ctx.model, enabledModels)
    ) {
      ctx.ui.setFooter(undefined)
      return
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender())
      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const model = ctx.model
          if (!model) return []

          let cwd = ctx.sessionManager.getCwd()
          const home = process.env["HOME"] || process.env["USERPROFILE"]
          if (home) {
            const fromHome = relative(resolve(home), resolve(cwd))
            if (
              fromHome === "" ||
              (fromHome !== ".." &&
                !fromHome.startsWith(`..${sep}`) &&
                !isAbsolute(fromHome))
            ) {
              cwd = fromHome === "" ? "~" : `~${sep}${fromHome}`
            }
          }
          const branch = footerData.getGitBranch()
          if (branch) cwd += ` (${branch})`
          const sessionName = ctx.sessionManager.getSessionName()
          if (sessionName) cwd += ` • ${sessionName}`

          let input = 0
          let output = 0
          let cacheRead = 0
          let cacheWrite = 0
          let cost = 0
          let latestCacheHitRate: number | undefined
          for (const entry of ctx.sessionManager.getEntries()) {
            if (
              entry.type === "message" &&
              entry.message.role === "assistant"
            ) {
              const usage = entry.message.usage
              input += usage.input
              output += usage.output
              cacheRead += usage.cacheRead
              cacheWrite += usage.cacheWrite
              cost += usage.cost.total
              const promptTokens =
                usage.input + usage.cacheRead + usage.cacheWrite
              latestCacheHitRate =
                promptTokens > 0
                  ? (usage.cacheRead / promptTokens) * 100
                  : undefined
            } else if (
              entry.type === "message" &&
              entry.message.role === "toolResult" &&
              entry.message.usage
            ) {
              input += entry.message.usage.input
              output += entry.message.usage.output
              cacheRead += entry.message.usage.cacheRead
              cacheWrite += entry.message.usage.cacheWrite
              cost += entry.message.usage.cost.total
            } else if (
              (entry.type === "branch_summary" ||
                entry.type === "compaction") &&
              entry.usage
            ) {
              input += entry.usage.input
              output += entry.usage.output
              cacheRead += entry.usage.cacheRead
              cacheWrite += entry.usage.cacheWrite
              cost += entry.usage.cost.total
            }
          }

          const stats: string[] = []
          if (input) stats.push(`↑${formatFooterTokens(input)}`)
          if (output) stats.push(`↓${formatFooterTokens(output)}`)
          if (cacheRead) stats.push(`R${formatFooterTokens(cacheRead)}`)
          if (cacheWrite) stats.push(`W${formatFooterTokens(cacheWrite)}`)
          if (cacheRead && latestCacheHitRate !== undefined) {
            stats.push(`CH${latestCacheHitRate.toFixed(1)}%`)
          }
          if (cost) stats.push(`$${cost.toFixed(3)}`)
          const contextUsage = ctx.getContextUsage()
          const contextWindow =
            contextUsage?.contextWindow ?? model.contextWindow
          const percent = contextUsage?.percent
          stats.push(
            percent == null
              ? `?/${formatFooterTokens(contextWindow)}`
              : `${percent.toFixed(1)}%/${formatFooterTokens(contextWindow)}`,
          )
          const statsLeft = stats.join(" ")

          let right = model.id
          if (model.reasoning) {
            const thinkingLevel = ctx.thinkingLevel || "off"
            right =
              thinkingLevel === "off"
                ? `${right} • thinking off`
                : `${right} • ${thinkingLevel}`
          }
          if (footerData.getAvailableProviderCount() > 1) {
            right = `(${model.provider}) ${right}`
          }
          const padding = " ".repeat(
            Math.max(
              1,
              width - visibleWidth(statsLeft) - visibleWidth(right) - 2,
            ),
          )
          const modelLine = truncateToWidth(
            theme.fg("dim", statsLeft + padding) +
              theme.fg("warning", "↯") +
              theme.fg("dim", ` ${right}`),
            width,
          )
          const statusLines = [...footerData.getExtensionStatuses().entries()]
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => text)
          return [
            theme.fg("dim", truncateToWidth(cwd, width)),
            modelLine,
            ...statusLines.map((line) => truncateToWidth(line, width)),
          ]
        },
      }
    })
  }

  function loadConfig(ctx: ExtensionContext): void {
    enabledModels = new Set()
    tpsEnabled = true
    try {
      const config = readConfig()
      enabledModels = new Set(config.models)
      tpsEnabled = config.tpsEnabled
    } catch (error) {
      notify(
        ctx,
        error instanceof Error ? error.message : String(error),
        "error",
      )
    }
    setTpsEnabled(tpsEnabled, ctx)
    updateFastFooter(ctx)
  }

  pi.registerCommand("fast", {
    description: "Toggle Fast Mode for a model",
    handler: async (args, ctx) => {
      if (args.trim()) {
        notify(ctx, "Usage: /fast", "error")
        return
      }
      if (!ctx.hasUI) return

      const models = getAvailableFastModels(ctx.modelRegistry.getAvailable())
      if (models.length === 0) {
        notify(ctx, "No OpenAI models are available in Pi.")
        return
      }

      const selected = await ctx.ui.select(
        "Toggle Fast Mode:",
        models.map(
          (model) => `${enabledModels.has(model) ? "✓" : " "} ${model}`,
        ),
      )
      if (!selected) return

      const key = selected.slice(2)
      const nextEnabledModels = new Set(enabledModels)
      const enabled = !nextEnabledModels.has(key)
      if (enabled) nextEnabledModels.add(key)
      else nextEnabledModels.delete(key)

      try {
        writeConfig(nextEnabledModels, tpsEnabled)
        enabledModels = nextEnabledModels
      } catch (error) {
        notify(
          ctx,
          error instanceof Error ? error.message : String(error),
          "error",
        )
        return
      }

      updateFastFooter(ctx)
      notify(ctx, `Fast Mode ${enabled ? "enabled" : "disabled"} for ${key}.`)
    },
  })

  pi.on("session_start", (_event, ctx) => {
    loadConfig(ctx)
  })

  pi.on("model_select", (_event, ctx) => {
    updateFastFooter(ctx)
  })

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined)
  })

  pi.on("before_provider_request", (event, ctx) => {
    if (!isFastModel(ctx.model, enabledModels) || !isRecord(event.payload)) {
      return undefined
    }

    return { ...event.payload, service_tier: DEFAULT_SERVICE_TIER }
  })
}

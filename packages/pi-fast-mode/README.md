# @tifan/pi-fast-mode

Toggle OpenAI Fast Mode per model and track response TPS.

## Install

```bash
pi install npm:@tifan/pi-fast-mode
```

## Usage

Run `/fast` to open the list of supported models. Select a model to toggle Fast Mode. Enabled models are marked `✓`. The setting is saved per exact `provider/model` pair.

Run `/tps` to toggle response TPS. The setting is saved in the same configuration file.

When TPS is enabled, the status shows the latest response rate, median response rate, and median time to first token:

```text
last 58 t/s · med 44 t/s | 2.1s ttft
```

Response TPS uses Pi's provider-reported output tokens divided by the time from turn start to assistant message end. It includes reasoning tokens and response wait time. It does not include time spent executing tools.

Fast Mode adds `service_tier: "priority"` for enabled `openai` and `openai-codex` models available in Pi. The list updates with Pi's model catalog, but OpenAI does not publish Fast Mode compatibility metadata. An unsupported model may reject the request.

## Configuration

Preferences are stored at `$PI_CODING_AGENT_DIR/extensions/pi-fast-mode.json`:

```json
{
  "models": ["openai-codex/gpt-6-luna"],
  "tpsEnabled": true
}
```

`tpsEnabled` defaults to `true` when it is missing. Enable Fast Mode only for models that support the `priority` service tier. Unsupported models may reject requests.

## Release notes

See [CHANGELOG.md](https://github.com/tifandotme/pi-extensions/blob/master/packages/pi-fast-mode/CHANGELOG.md)

## License

[MIT](https://github.com/tifandotme/pi-extensions/blob/master/LICENSE)

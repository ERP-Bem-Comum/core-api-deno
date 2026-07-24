# Referência — Deno

Referência **offline** do runtime Deno, no mesmo papel que [`handbook/reference/nodejs/`](../nodejs/) tem para o Node. Ancora o agente [`deno-runtime-expert`](../../../.claude/agents/deno-runtime-expert.md) e sustenta o cutover Node→Deno ([ADR-0054](../../architecture/adr/0054-deno-runtime-supersedes-node.md) · [ADR-0056](../../architecture/adr/0056-deno-only-cutover-amends-0054.md)).

## Proveniência e atualidade

- **Fonte:** `https://docs.deno.com` — arquivos LLM-friendly **oficiais**, gerados pelo próprio Deno a partir do source (repo [`denoland/docs`](https://github.com/denoland/docs), Lume).
- **Baixado em:** 2026-07-24. **Deno instalado:** `2.9.3 (stable, aarch64-apple-darwin)` · V8 14.9 · TypeScript 6.0.3.
- **Natureza:** snapshot. Para atualizar, ver §"Como atualizar" abaixo — é um `curl` de 4 URLs.
- **Licença:** docs do Deno são MIT (mesmo do runtime). Conteúdo público — sem segredo.

## Arquivos (o que citar)

| Arquivo | Tamanho | Uso |
| --- | --- | --- |
| [`llms.txt`](./llms.txt) | ~5 KB | **Índice** agrupado (Runtime / Deploy / Sandbox / Examples / Optional) com URL de cada página. Ponto de partida da navegação. |
| [`llms-summary.txt`](./llms-summary.txt) | ~26 KB | **Catálogo** com 1 parágrafo por página — bom para localizar o tópico certo antes de abrir a página viva. |
| [`llms-full.txt`](./llms-full.txt) | ~2.4 MB | **Conteúdo completo** offline. É a fonte citável por linha (`llms-full.txt:LINHA`) e grep-ável quando não há rede. Dump plano — navegue por `grep -n '^# '`. |
| [`llms-full-guide.txt`](./llms-full-guide.txt) | ~6 KB | **Quick reference** agent-oriented: CLI, permissões, `deno.json`, specifiers, testing, `Deno.serve`. Leitura de 2 min. |

## Escopo

**Dentro** (o que ancora o agente): a seção **Runtime** + a **API Reference**. É o runtime self-hosted (o `core-api` roda em container próprio no ECS/VPS/homelab — ver memórias de deploy).

**Fora** (plataforma gerenciada da Deno, não usamos): **Deploy**, **Sandbox** (microVM Firecracker — avaliado e descartado para a VAN-Bancária: overkill p/ deps pinados), **Subhosting**. Vários marcados *"Sunsetting on July 20, 2026"* no próprio dump. Deno **KV** também está fora (usamos MySQL→PostgreSQL, ADR-0055).

## Mapa Runtime (URLs vivas — a navegação canônica)

Fundamentals:
- [Security and permissions](https://docs.deno.com/runtime/fundamentals/security) — modelo secure-by-default, sandbox, `--allow-*`, permission broker.
- [Modules and Imports](https://docs.deno.com/runtime/fundamentals/modules) — `jsr:`/`npm:`/`node:`, import maps, import attributes, Wasm/data URLs.
- [Node and npm Compatibility](https://docs.deno.com/runtime/fundamentals/node) — `node:` built-ins, `npm:` sem `node_modules`, respeito a `package.json`.
- [Configuration (deno.json)](https://docs.deno.com/runtime/fundamentals/configuration) — tasks, import map, TS settings, `.jsonc`, discovery.
- [TypeScript support](https://docs.deno.com/runtime/fundamentals/typescript) — `.ts` sem build, `deno check`, reuso de `tsconfig.json`.
- [Testing](https://docs.deno.com/runtime/fundamentals/testing) — runner nativo, assertions, mocking, coverage, reporters.
- [HTTP Server](https://docs.deno.com/runtime/fundamentals/http_server) — `Deno.serve`, WebSockets.
- [Workspaces](https://docs.deno.com/runtime/fundamentals/workspaces) — monorepo, member `name`/`exports`, catalogs.
- [Linting and Formatting](https://docs.deno.com/runtime/fundamentals/linting_and_formatting) — `deno lint`, `deno fmt`, regras, CI.
- [Stability and releases](https://docs.deno.com/runtime/fundamentals/stability_and_releases) — canais, LTS, features unstable, versionamento.
- [FFI](https://docs.deno.com/runtime/fundamentals/ffi) · [Cron](https://docs.deno.com/runtime/fundamentals/cron) · [OpenTelemetry](https://docs.deno.com/runtime/fundamentals/open_telemetry) · [Debugging](https://docs.deno.com/runtime/fundamentals/debugging) · [CPU profiling](https://docs.deno.com/runtime/fundamentals/cpu_profiling).

Getting started / operação:
- [Run code](https://docs.deno.com/runtime/run/) — permission model, watch mode, tasks, args, stdin/URL.
- [Dependency management](https://docs.deno.com/runtime/packages/) — `deno add`/`install`/`update`/`audit`, lockfile, lifecycle scripts, overrides.
- [Migrate from Node.js](https://docs.deno.com/runtime/migrate/) — Deno como package manager drop-in, `package.json` scripts, CJS↔ESM, mapa de comandos.
- [Deploying your app](https://docs.deno.com/runtime/deploy/) — **containers e Docker**, self-host de binário standalone (o nosso caso).
- [CLI apps](https://docs.deno.com/runtime/cli_apps/) — `deno compile` → binário único self-contained.
- [CLI Reference](https://docs.deno.com/runtime/reference/cli/) — todos os subcomandos e flags.
- [Standard Library (@std)](https://docs.deno.com/runtime/reference/std/) · [`jsr.io/@std`](https://jsr.io/@std).

## Mapa API Reference

- [Deno namespace APIs](https://docs.deno.com/api/deno/) — `Deno.serve`, `Deno.Command`, `Deno.readTextFile`, `Deno.permissions`, etc.
- [Web Platform APIs](https://docs.deno.com/api/web/) — `fetch`, `crypto.subtle`, Streams, `structuredClone`, Workers.
- [Node.js built-in APIs (compat)](https://docs.deno.com/api/node/) — `node:crypto`, `node:fs/promises`, `node:test`, `node:path`… (o alicerce da migração: os testes `node:test` rodam **nativos** sob `deno test`).

## Como citar

1. **Prosa conceitual / decisão de design** → cite a **URL viva** (mais atual que o snapshot). Ex.: `https://docs.deno.com/runtime/fundamentals/security`.
2. **Citação literal offline / sem rede** → `handbook/reference/deno/llms-full.txt:LINHA`. Localize a seção com `grep -n '^# ' llms-full.txt`.
3. Nunca citar "de memória" — abrir o arquivo/URL (anti-padrão #12 do AGENTS.md).

## Como atualizar (re-snapshot)

```bash
cd handbook/reference/deno
for f in llms.txt llms-summary.txt llms-full.txt llms-full-guide.txt; do
  curl -sSL -o "$f" "https://docs.deno.com/$f"
done
```

Atualizar também a data e a versão do Deno no topo deste README.

## Recursos externos relacionados

- [`denoland/skills`](https://github.com/denoland/skills) — **skills/playbooks oficiais do Deno para agentes de IA**. Fonte primária para padrões Deno-idiomáticos ao codar.
- [`jsr.io`](https://jsr.io) — registro nativo do Deno (preferência de dependência no cutover, ver ADR-0056 §Dependências).

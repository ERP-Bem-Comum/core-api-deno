import { fileURLToPath } from 'node:url';

// Diretório do módulo a partir de `import.meta.url`. Usa `import.meta.url` (tipado `string` tanto
// no tsc/@types/node quanto no Deno) em vez de `import.meta.dirname` (que o Deno tipa `string |
// undefined` — é `undefined` para módulos não-file, divergindo do tsc). Mantém o typecheck verde
// nos dois runtimes durante o cutover, sem narrowing que o eslint marcaria como desnecessário.
export const moduleDir = (metaUrl: string): string => fileURLToPath(new URL('.', metaUrl));

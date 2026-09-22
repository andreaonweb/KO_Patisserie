// Genera src/environments/environment.ts a partir de variables de entorno.
//
// environment.ts está en .gitignore (guarda claves) por lo que en un build
// limpio (como el de Render) no existe. Este script lo crea antes de `ng build`
// leyendo las variables de entorno del servicio de Render (Static Site > Environment).
//
// Uso local: no hace falta, seguí usando environment.example.ts como plantilla.
// Uso en Render: build command -> "node scripts/generate-env.mjs && npm run build"

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "src", "environments", "environment.ts");

const apiUrl = process.env["API_URL"];
if (!apiUrl) {
  console.error("[generate-env] Falta la variable de entorno API_URL (URL del backend en Render).");
  process.exit(1);
}

const tmbAppId = process.env["TMB_APP_ID"] ?? "";
const tmbAppKey = process.env["TMB_APP_KEY"] ?? "";

const content = `// Generado automáticamente por scripts/generate-env.mjs durante el build.
// No editar a mano: los valores salen de las variables de entorno del servicio.
export const environment = {
  production: true,
  apiUrl: '${apiUrl}',
  tmb: {
    appId: '${tmbAppId}',
    appKey: '${tmbAppKey}',
  }
};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, content, "utf-8");
console.log(`[generate-env] Escrito ${outFile} (apiUrl=${apiUrl})`);

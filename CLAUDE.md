# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## El proyecto

PWA de campo para inspección post-sísmica ATC-20 de edificaciones (doblete Mw 7,2 y 7,5 del 24/06/2026, Yaracuy, Venezuela). BSP = Building Safety Program. La usa el Ing. Eduardo Lubo (CIV 115.692) en el teléfono, dentro de edificios, muchas veces sin señal.

Consecuencias de ese contexto que mandan sobre las decisiones de diseño:

- **Offline-first, no negociable.** Nada puede depender de la red para funcionar. La nube es respaldo, no requisito.
- **Nunca perder datos capturados.** Una foto o una medida que se pierde implica volver al edificio.
- **Un dedo, pantalla pequeña, luz mala.** `main` tiene `max-width: 460px`; los botones son grandes; los inputs van a 16 px para que iOS no haga zoom.
- **El código y la UI están en español**, incluidos nombres de funciones y variables (`guardar`, `cmpParcial`, `rUnidad`). Mantenerlo así.

## Comandos

No hay build, ni bundler, ni `package.json`, ni tests. Las librerías (JSZip, jsPDF, supabase-js) entran por CDN vía `<script>`.

```bash
python3 -m http.server 8000     # servidor local; abrir http://localhost:8000
                                # obligatorio: el service worker y IndexedDB no
                                # funcionan con file://
git push                        # despliega — GitHub Pages sirve main directamente
```

Se prueba a mano en el navegador (con DevTools en modo móvil) y en el teléfono contra `https://bsweetlife.github.io/bsp-inspeccion/`. Para verificar un cambio del service worker hay que usar *Application → Service Workers → Update on reload*, o el botón «Buscar actualización» en Ajustes.

## Ritual de versión (lo más fácil de olvidar)

Cada cambio funcional sube la versión, y son **tres** sitios que tienen que moverse juntos:

1. `VERSION` en `index.html:124`.
2. Una entrada nueva al principio de `CHANGELOG` (`index.html:125`) — redactada para el inspector, no para el programador: qué cambió de lo que él ve, sin jerga de código. Mirar las entradas existentes para el tono.
3. `CACHE` en `sw.js:1` (`bsp-vNN` → `bsp-vNN+1`).

**Si se olvida el `CACHE` de `sw.js`, el `activate` no borra la caché vieja y los teléfonos siguen con la versión anterior instalada.** El `fetch` va a la red primero para las páginas, lo que amortigua el problema, pero los iconos y las librerías de CDN sí se quedan pegados.

El commit sigue el formato de los anteriores: `vX.YZ: descripción corta en lenguaje de usuario`.

### Partir siempre de la punta de `main`

**Antes de editar, confirmar que el `index.html` de partida es el de `HEAD`**, no una copia guardada aparte:

```bash
git log --oneline -1 && sed -n '124p' index.html && sed -n '1p' sw.js
```

Los tres números tienen que ser coherentes entre sí: la versión del último commit, el `VERSION` del archivo y el `CACHE` del service worker. Y `VERSION` y `CACHE` **solo suben, nunca bajan**.

Esto pasó de verdad: los commits `fa09bd6`, `534124f` y `d173da2` (titulados «v3.29/3.30/3.31») se hicieron sobre una base de la época de la 3.28 cuando `main` ya iba por la 3.52. El diff añadió 107 líneas y borró 746: se perdió todo lo hecho entre la 3.29 y la 3.52, incluida la partida `02.09` y los criterios de obra del dictado. Peor aún, `CACHE` retrocedió de `bsp-v66` a `bsp-v43`, así que los teléfonos que ya tenían la v66 no reconocían la v43 como versión nueva y se quedaban sin actualizar. Se arregló en `1a7f7a9` (v3.53) reaplicando el trabajo sobre la 3.52 real, con `CACHE` en `bsp-v67` para volver a quedar por delante.

Por eso `git log` no está en orden de versión: esos tres commits siguen en `main` con títulos que chocan con las versiones 3.29–3.31 reales del `CHANGELOG` (partida 02.08, acarreo de escombros, replicar líneas). **Al leer el historial, la fuente de verdad de qué trae cada versión es el `CHANGELOG` del código, no los títulos de los commits.**

`.respaldo/`, `bsp-index-v3.*.html` y `sw-v3.*.js` están en `.gitignore`: son copias locales de versiones anteriores. Los archivos `bsp-index-v3.52.html` y `sw-v3.52.js` que están en la raíz son restos de ese esquema, no se usan.

## Arquitectura

Todo vive en **`index.html`** (~4400 líneas: HTML + CSS + JS vanilla en un solo archivo). Está dividido en secciones marcadas con comentarios `/* ===== Nombre ===== */`, que son la forma práctica de navegarlo:

```
Constantes · Nube (Supabase) · IndexedDB · Estado · Cómputos métricos ·
Imagen · Navegación/render · Pantalla: login/lista/setup/casa/nivel/unidad ·
Visor de foto · Editor de anotaciones · Sello de fotos · Resumen PDF ·
Medición sobre fotografía · Ajustes/API · Inicio
```

`verificar.html` es una página aparte y autónoma (verificación pública de informes por código QR); **está en modo demostración**, sin conectar al registro. No comparte código con la app.

### Render

Sin framework. Un estado global `st` (`index.html:391`) y un despachador `render()` (`index.html:1174`) que, según `st.pantalla.n`, llama a la función `rXxx()` correspondiente; esa función reescribe `$app.innerHTML` completo con un template string y luego cablea los `onclick`. `nav({n:"..."})` cambia de pantalla y sube el scroll.

Implicaciones al trabajar aquí:

- **Todo lo interpolado en HTML pasa por `esc()`.** Nombres de edificio, observaciones dictadas y descripciones de fotos son entrada del usuario.
- Un repintado destruye los nodos: no guardar referencias a elementos entre renders, y volver a cablear los eventos después de cada repintado. Los bugs de las v3.38/3.39 fueron exactamente esto.
- El botón de volver es un `switch` central en `index.html:1152`; cada pantalla nueva tiene que añadir su caso ahí.

### Persistencia: tres capas

**IndexedDB** (`bsp-inspeccion`, v1) con dos object stores planos: `kv` para JSON y `blobs` para fotos y audio. Helpers `kvGet/kvSet/kvDel` y `blobGet/blobSet/blobDel`. Las claves son convención, no esquema:

| Clave | Contenido |
|---|---|
| `index` | array de resúmenes de inspección para la pantalla de lista |
| `insp:<id>` | la inspección completa serializada |
| `proxInforme` | siguiente número de informe a proponer |
| `photo:<id>` / `audio:<id>` | blobs (nótese el prefijo, distinto store) |

`guardar()` (`index.html:1092`) es la única vía de escritura: debounce de 500 ms, sella `st.insp._ts`, actualiza el resumen en `index`, refleja el estado en la cabecera y llama a `programarSubida()`. Llamarlo tras cada mutación de `st.insp` en vez de escribir a IndexedDB directamente.

**Supabase** (`index.html:202`): auth por correo, tabla `inspecciones` (`id`, `user_id`, `data` JSON, `updated_at`) y bucket de storage `archivos` con rutas `<user_id>/photo_<id>.jpg` y `<user_id>/audio_<id>.{m4a,webm}`. La `SUPA_KEY` del código es la publishable — la seguridad depende de las RLS policies del proyecto Supabase, no del cliente.

La sincronización (`sincronizar()`, `index.html:288`) es **last-write-wins comparando `data._ts` local contra `updated_at` remoto**; no hay merge. Baja lo remoto más reciente, luego sube todas las locales. `blobsDeInsp()` es el punto único que enumera qué blobs pertenecen a una inspección: al añadir un sitio nuevo donde se guarden fotos o audio, **hay que registrarlo ahí**, o esos archivos no se suben, no se bajan y no se borran.

Una fila especial `_ajustes_<user_id>` sincroniza el contador `proxInforme` entre dispositivos.

**Service worker** (`sw.js`): las páginas van a red primero con caída a caché (así nunca se queda una versión atrás); el resto es caché primero. Las peticiones a `api.anthropic.com` y `*.supabase.co` se dejan pasar sin interceptar.

### Cómputos métricos

Es el módulo más grande y el más delicado; todo lo suyo lleva prefijo `cmp`. Los datos viven en `st.insp.computos.lineas`.

**Catálogo de partidas** (`CMP_CAT`, `index.html:442`): tuplas `[codigo, grupo, descripcion, unidad, notas]` con códigos `NN.NN` por grupo (01 preliminares, 02 demoliciones, 03 reparación estructural, 04 mampostería y acabados, 05 instalaciones, 06 fachadas, `99.99` = «Otro» personalizado). Al construirse, cada partida se fusiona con su override de `CMP_MEDIDA`.

Qué campos de dimensión pide una partida se resuelve en cascada: `p.campos` → override en `CMP_MEDIDA` → por defecto según la unidad en `CMP_UNI_CAMPOS`. `cmpParcial()` simplemente **multiplica todos los campos** de la partida (con `diametro` resolviendo a kg/m vía `CMP_CABILLA`). Es decir: para cambiar cómo se mide una partida se edita su entrada en `CMP_MEDIDA`, no se toca la aritmética.

**Partidas compuestas** (`CMP_COMPUESTAS`, `index.html:649`): un elemento a reparar del que se derivan varias partidas a partir de unas pocas dimensiones. Cada una declara `campos`/`etiquetas`, la `magnitud` y `unidad` de la medida base, y `componentes[]`, donde cada componente referencia una `partida` del catálogo con:

- `factor` — multiplicador sobre la medida base
- `base` — de qué se calcula: área (por defecto), `"largo"`, `"volumen"`, `"desarrollo"`
- `unidad` — si el componente se computa en unidad distinta de la de la compuesta
- `caras: "frisar" | "pintar"` — se multiplica por el número de caras seleccionadas
- `alcance: true` — permite elegir el alcance (todo el paño / solo lo intervenido)
- `defOff: true` — aparece desmarcado, opcional

Añadir una compuesta es añadir un objeto a ese array, siempre que las partidas que necesita ya existan en `CMP_CAT`. No hay que tocar la UI.

**Acarreo de escombros** (`index.html:587`) se deriva solo: cada partida de demolición tiene un espesor típico en `ESPESOR_ESCOMBRO`, el volumen en banco es la suma de área × espesor, el suelto aplica esponjamiento (40 % por defecto) y de ahí salen los viajes de volqueta.

Además: `cmpValidar()` centraliza las reglas (una medida de origen `planos` o `muestreo` exige observación que explique el criterio), `cmpAtipico()` avisa de valores fuera de rango sin bloquear, `cmpAgrupar()` totaliza por código para el resumen, y `cmpPie()` redacta el pie de foto técnico que sale en la exportación.

### Integración con Claude

`llamarClaude(prompt, maxTokens)` (`index.html:4335`) golpea `api.anthropic.com/v1/messages` directamente desde el navegador con `anthropic-dangerous-direct-browser-access`. Modelo `claude-sonnet-4-6`. La clave la pone el inspector en Ajustes y queda solo en su dispositivo (`st.apiKey`).

Dos usos: `asistirIA()` redacta el resumen de hallazgos de una unidad, y `cmpDictarTareas()` (`index.html:842`) convierte un dictado de voz en una partida compuesta — su prompt inyecta el catálogo y las compuestas existentes, y codifica criterios de obra (reponer cerámica de piso de baño arrastra desmontar y montar poceta y lavamanos). Espera JSON de vuelta y lo parsea a la defensiva (quita fences de markdown, recorta a las llaves exteriores).

**La IA es siempre opcional.** Sin clave la app funciona igual y solo se desactivan esos botones; ninguna ruta crítica puede depender de ella.

### Exportación

`textoExport()` genera el informe en texto, `rExport()` arma el resumen PDF con jsPDF, y las fotos y cómputos salen en ZIP con JSZip, **partido en trozos de menos de 1 MB** con fotos recomprimidas, para poder pasarlos luego a análisis. `cmpMarca()` sella las fotos exportadas con la marca de partida.

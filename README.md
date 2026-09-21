# CHUCK's Tools Suite

Aplicación de escritorio para Windows, macOS y Linux que reúne herramientas locales de gestión de archivos en una sola interfaz. Está construida con Electron, React, TypeScript y Vite.

Las operaciones sobre archivos locales se ejecutan en el equipo del usuario. El módulo de Descargas realiza solicitudes a las URLs ingresadas y, cuando corresponde, a las APIs públicas de MediaFire o Google Drive.

La interfaz incluye un botón **Modo claro / Modo oscuro** en la barra lateral, con la preferencia persistida localmente y sincronizada con `prefers-color-scheme` en el primer inicio. Toda la suite (Gestor de descargas, Identificador, Colección, Organizar, Renombrar, Video a SD, Normalizar, AnalogReplayTV, Wishlist y los modales) se reeskinna al cambiar de tema; la barra lateral permanece con su croma oscuro característico en ambos modos.

## Herramientas incluidas

### Organizar archivos

Busca archivos de forma recursiva dentro de una carpeta de origen y mueve los seleccionados a una carpeta de destino.

Características:

- Exploración de la carpeta de origen y todas sus subcarpetas.
- Categorías para videos, audio, imágenes, documentos y archivos comprimidos.
- Extensiones personalizadas separadas por espacios, comas o punto y coma.
- Vista previa con ruta relativa y tamaño de cada archivo.
- Selección individual o global de resultados.
- Resolución automática de nombres duplicados mediante sufijos numéricos.
- Compatibilidad con movimientos entre unidades o discos diferentes.
- Eliminación opcional de las carpetas hijas del origen.
- Creación de una carpeta de destino dentro de la carpeta de origen.
- Devolución opcional del lote a la raíz del origen después de mover y limpiar.
- Acción Deshacer para restaurar las ubicaciones originales y recrear su estructura.
- Reset de pantalla para limpiar selección de carpetas, resultados, filtros y opciones.
- Eliminación opcional del destino temporal creado por la aplicación después de devolver el lote.

> **Advertencia:** la opción para eliminar carpetas hijas borra recursivamente las subcarpetas y cualquier contenido que permanezca dentro de ellas; la interfaz solicita confirmación antes de ejecutarla. La carpeta de origen nunca se elimina.

La carpeta de destino debe ser diferente de la de origen; si está dentro del origen, se excluye del escaneo y se conserva durante la limpieza de carpetas hijas.

### Renombrar archivos

Permite modificar los nombres de los archivos de una o varias carpetas en una misma ejecución.

Características:

- Selección de varias carpetas (o una sola) con "Añadir carpetas", limpieza y eliminación individual.
- Vista previa del resultado antes de aplicar cambios, mostrando la carpeta de origen cuando hay varias.
- Búsqueda y reemplazo de texto.
- Reemplazo desde el inicio hasta incluir un texto determinado.
- Reemplazo desde un texto determinado, incluyéndolo, hasta el final.
- Adición de prefijos y sufijos.
- Selección individual o global de archivos.
- Conservación de la extensión original.

### Video a SD

Convierte videos a una resolución máxima de 480p y los guarda siempre como MP4, conservando los archivos originales.

Características:

- Selección de varias carpetas en una misma ejecución.
- Formatos MP4, M4V, MOV, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, TS, MTS, M2TS, VOB, OGV, 3GP, 3G2 y ASF.
- Códec H.264 para máxima compatibilidad o H.265 para mayor compresión.
- Selección de pistas de audio y subtítulos en contenedores MKV: el audio se convierte a AAC de 128 kbps y los subtítulos de texto a `mov_text`; los basados en imagen (PGS, VobSub) se omiten por incompatibilidad con MP4.
- Progreso global y por archivo en tiempo real con cancelación del proceso activo.
- Cola dinámica: se pueden añadir o quitar carpetas durante la conversión, con recálculo del progreso.
- Carpetas colapsables con selección persistente de pistas y accesos rápidos para seleccionar o deseleccionar todas las pistas de audio y subtítulos de cada video.
- Las carpetas que dejes colapsadas se mantienen así al navegar entre secciones o reiniciar la aplicación.
- Indicador de completado por archivo: cada video ya convertido se marca con ✓ y la carpeta se resalta cuando todos sus archivos están procesados.
- Botón Limpiar que restablece la cola, las selecciones de pistas y el estado del proceso también en el menú lateral.
- Normalización opcional del audio con `loudnorm` y objetivo de LUFS configurable (recomendado -16).
- Salida MP4 en `sd-output-h264` o `sd-output-h265` con sufijo `_SD`; los originales nunca se modifican.

Como el resultado siempre es MP4, la herramienta avisa que se pierde detalle visual y el audio se comprime.

### Normalizar volumen

Normaliza la sonoridad percibida de archivos de audio o de las pistas de audio contenidas en videos.

- Procesamiento de varias carpetas.
- Objetivo configurable entre -50 y -5 LUFS.
- Valor recomendado de -16 LUFS para contenido general.
- Proceso independiente de la navegación: continúa aunque cambies de sección dentro de la suite.
- Barra de progreso en el sidebar con el porcentaje global de la cola.
- Progreso por archivo y cancelación del proceso activo.
- Indicador de completado por archivo: cada audio o video ya normalizado (existente en `normalized_output-...`) se marca con ✓, tanto al explorar como al terminar durante la ejecución.
- Video copiado sin recodificar para evitar pérdida visual y reducir el tiempo de proceso.
- Resultado guardado en `normalized_output-audio` (archivos de audio) o `normalized_output-video` (videos) dentro de cada carpeta, con el sufijo `_normalized`.
- Los archivos originales nunca se reemplazan.

La normalización utiliza el filtro `loudnorm` de FFmpeg. Los archivos ya terminados en `_normalized` se excluyen del siguiente escaneo para evitar procesarlos repetidamente.

### Colección

Permite crear catálogos locales con fichas personalizadas y persistencia SQLite.

- Múltiples colecciones con nombre, descripción y tipo.
- Columnas configurables de texto, número, booleano, fecha, URL o etiquetas.
- Campos obligatorios y validación de datos antes de guardar.
- Vista en tarjetas con imágenes remotas por URL HTTP o HTTPS.
- Búsqueda, edición y eliminación de ítems.
- Buscador de imágenes en internet al crear o editar un ítem: modal con motores Bing, Google, DuckDuckGo, Wikimedia Commons y Openverse que muestra solo imágenes; al hacer clic en una y confirmar con "Usar esta imagen", su URL queda asignada al ítem. Cambiar de motor o lanzar una búsqueda limpia los resultados anteriores.
- Importación y exportación de cada colección en formato JSON.
- Base de datos guardada en el directorio local de datos de Electron.
- Wishlist con nombre, manufacturero, año y múltiples páginas de tienda por artículo.
- Consulta de precios mediante scraping local de JSON-LD, metadatos de producto y HTML.

### Gestor de descargas

Gestor inspirado en el flujo de JDownloader con una interfaz reducida a tres pestañas: Descargas, Identificador y Configuración.

- Captura opcional de uno o varios enlaces desde el portapapeles.
- Resolución previa de URLs cortas y páginas como MediaFire y Fireload.
- Comprobación de disponibilidad antes de añadir a la cola.
- Carpeta de destino individual, múltiple o predeterminada.
- Prioridades urgente, alta, media y baja.
- Renombrado antes de descargar y mientras la tarea no esté activa.
- Cola persistente agrupada por carpeta de destino.
- Grupos colapsables con barra de progreso general en el encabezado.
- Los grupos y colecciones que dejes colapsados se mantienen así al navegar entre secciones o reiniciar la aplicación.
- Contraseña de extracción asignable a un grupo o colección completa (botón ⌕ del encabezado): se aplica a las tareas pendientes y reintenta la extracción de las que requieren contraseña.
- Indicador de éxito cuando todas las descargas de un grupo se completan.
- Segundo nivel de agrupación por colección de enlaces, también colapsable, con nombre editable asignable a varios enlaces.
- Colapsado de grupos y colecciones en **Identificador** con estado persistente entre secciones y reinicios de la aplicación.
- Eliminación individual de enlaces identificados o de una colección completa desde **Identificador**, con confirmación para colecciones.
- Listado de enlaces identificados reubicado debajo del botón "Añadir a descargas →" para que el footer de envío sea visible junto a la selección actual.
- Expansión recursiva de carpetas públicas de MediaFire (conservando subcolecciones) y resolución de páginas de archivo al enlace directo de su CDN, sin sesión.
- Soporte de **Fireload** mediante detección por dominio y extracción del enlace directo desde el botón de descarga o atributos `data-download-url`/`data-url` de la página, sin sesión.
- Botón **Mostrar carpeta** en el encabezado de cada grupo para abrir la carpeta destino en el explorador.
- Botones globales **Pausar todo**, **Continuar todo** y **Detener todo** en la barra de descargas, que actúan sobre todas las tareas de la lista con la lógica de selección por estado ya existente.
- Modal **Listar enlaces** desde la barra de descargas: muestra todas las URLs en cola, una por línea, con "Copiar todos" al portapapeles y "Cerrar".
- Indicador en vivo del espacio del disco predeterminado (C: en Windows, raíz en macOS/Linux) con tamaño total y libre, refrescado cada 30 segundos.
- En **Configuración > Automatización** aparece la casilla **Eliminar comprimidos tras extraer** (activada por defecto), que se aplica a cada nuevo candidato identificado y puede ajustarse individualmente por enlace.
- Expansión recursiva de carpetas públicas de Google Drive con API key, detección de enlaces individuales y exportación automática de documentos de Google.
- Identificación y descarga de videos de YouTube (incluidos los atajos `youtu.be`), Vimeo, Dailymotion, TikTok, Twitch, X/Twitter, Facebook, Instagram, SoundCloud, VK, OK y Rutube mediante `yt-dlp`, sin necesidad de sesión.
- Al analizar un enlace de video, el **Identificador** muestra el título y genera un candidato por resolución disponible (de 144p a 2160p) más una opción de solo audio, todos seleccionados para añadir a la cola.
- La descarga de video selecciona el mejor formato con video y audio y lo fusiona en un único MP4; la opción de solo audio descarga el formato de mayor calidad de sonido.
- Si `yt-dlp` no reconoce el contenido de un video (por cambios recientes de YouTube), la aplicación intenta actualizar el binario automáticamente y reintenta el análisis antes de marcar el enlace como "No encontrado".
- De una a ocho descargas simultáneas con pausa, reanudación y detención, conservando archivos parciales.
- Progreso, tamaño y velocidad, con apertura del enlace original y localización del archivo descargado.
- Limpieza de tareas completadas.
- Al iniciar la aplicación, las tareas interrumpidas durante la extracción se reintentan automáticamente.
- Extracción automática de ZIP, 7z, RAR, TAR, GZ, BZ2 y XZ y reintento cuando un comprimido requiere contraseña.
- Detección automática de enlaces copiados (sin sondeo): los enlaces válidos se añaden a la sección **Identificador** con estado "En línea" o "No encontrado"; copiar una URL no inicia una descarga por sí mismo.
- Captura global desde cualquier sección: el botón **Descargas** del menú muestra el número de enlaces capturados recientemente y el indicador se reinicia al entrar.

Google Drive requiere una API key con Drive API habilitada; se configura en Descargas > Configuración. Solo pueden enumerarse carpetas compartidas públicamente: no se solicitan permisos sobre la cuenta personal del usuario.

Para configurar Google Drive:

1. Crea o selecciona un proyecto en Google Cloud Console.
2. Habilita **Google Drive API** desde la biblioteca de APIs.
3. Crea una credencial de tipo **API key**.
4. Restringe la clave para que solo pueda utilizar Google Drive API.
5. Pega la clave en la pestaña Configuración.

### AnalogReplayTV

Configuración de canales, programas y la programación de televisión compartida con AnalogReplayTV mediante una base de datos SQLite común. La interfaz se organiza en cuatro pestañas con contadores: Inicio, Canales, Programas y Programación.

- **Inicio**: resumen de la configuración con contadores de canales activos, programas, episodios totales y estado de la programación, más acciones rápidas para crear canales y programas.
- **Canales**: creación, edición y eliminación de canales de TV con número (1-999), nombre, descripción y estado habilitado; importación desde archivo JSON.
- **Programas**: fichas con nombre, canales asignados (por id, uuid o nombre), años de transmisión, opción "hasta la fecha" y modo de emisión (repetición diaria o una emisión por día).
  - Temporadas y episodios con título, duración y archivos; detección de episodios al elegir una carpeta de contenido y emparejamiento opcional de carpetas adicionales con los episodios existentes.
  - Ordenamiento de la lista por "Canal + Nombre", "Nombre" o "Año", y filtrado por canal.
  - Importación de programas desde archivo JSON.
- **Programación**: generación de la parrilla para un año eligiendo década y año, regeneración y reseteo completo.
  - Los programas se asignan a los canales que los tengan configurados y sean elegibles por la década de sus años de transmisión (o marcados como "hasta la fecha").
  - Los episodios se agrupan en bloques (capítulos de varias partes) y solo se programan temporadas cuya carpeta de contenido real exista.
  - El año se reparte en franjas de 30 minutos: el programa ocupa los bloques según su duración y el espacio sobrante se rellena con "Identificación de estación".
  - Los programas en modo "repetición diaria" se vuelven a emitir tras completar su ciclo; en modo "una emisión por día" se programan una sola vez al día.
  - Vista del día con rejilla de canales por franjas; el mes en curso se genera automáticamente si aún no existe al abrir la sección.

La base de datos SQLite compartida se guarda en el directorio local de datos de Electron.

## Requisitos

- Node.js 26.9.0 o posterior.
- npm 11.19.1 o posterior.
- FFmpeg y FFprobe para utilizar el módulo Video a SD.
- Conexión a Internet para Descargas, el buscador de imágenes de Colección y las integraciones con hosts externos.

HandBrakeCLI y 7-Zip se instalan mediante las dependencias `handbrake-js` y `7zip-min`; no requieren instalación manual independiente. `yt-dlp` se distribuye dentro de la aplicación (en `vendor/` al compilar) y, ante fallos de reconocimiento de videos, intenta actualizarse automáticamente y reintenta el análisis.

## Instalación

Desde la carpeta del proyecto:

```bash
npm install
```

## Uso

### Desarrollo

Inicia Vite y Electron con recarga del renderer:

```bash
npm run dev
```

### Compilación

Genera el frontend optimizado dentro de `dist/`:

```bash
npm run build
```

### Ejecución local

Después de compilar, inicia Electron usando los archivos de `dist/`:

```bash
npm start
```

### Empaquetado

Genera los ejecutables e instaladores con `electron-builder` dentro de `release/`:

```bash
npm run dist        # del sistema operativo actual
npm run dist:win    # Windows (instalador NSIS + portable)
npm run dist:mac    # macOS (DMG + ZIP)
npm run dist:linux  # Linux (AppImage + deb)
```

También está disponible `npm run pack`, que crea la aplicación desempaquetada en `release/<plataforma>-unpacked/` (útil para comprobaciones rápidas).

Cada plataforma debe empaquetarse desde su propio sistema operativo (o mediante CI multi-plataforma), ya que electron-builder incluye solo los binarios nativos de la plataforma de origen.

## Calidad de código

Ejecutar ESLint:

```bash
npm run lint
```

Aplicar correcciones automáticas de ESLint:

```bash
npm run lint:fix
```

Formatear el proyecto con Prettier:

```bash
npm run format
```

Comprobar el formato sin modificar archivos:

```bash
npm run format:check
```

Ejecutar pruebas, lint, comprobación de formato y build en secuencia:

```bash
npm run check
```

## Estructura

```text
CHUCK's Tools Suite/
├── electron/
│   ├── main.cjs             # Ventana, IPC y coordinación de procesos
│   ├── preload.cjs          # API segura expuesta al renderer
│   ├── audioNormalizer.cjs  # Normalización mediante FFmpeg
│   ├── analogReplay.cjs     # Canales, programas y generación de programación
│   ├── collectionManager.cjs # Colecciones y persistencia SQLite
│   ├── imageSearch.cjs      # Búsqueda de imágenes (Bing, Google, DuckDuckGo, Wikimedia, Openverse)
│   ├── priceScraper.cjs     # Scraping de precios para la wishlist
│   ├── renameManager.cjs    # Listado y renombrado de archivos
│   ├── videoConversion.cjs  # Conversión FFmpeg/HandBrake
│   ├── videoProvider.cjs    # Identificación y descarga de videos con yt-dlp
│   ├── urlResolver.cjs      # Resolución y validación segura de URLs
│   ├── clipboardWatcher.cjs # Detección de enlaces copiados
│   └── downloadManager.cjs  # Cola persistente y extracción
├── src/
│   ├── App.tsx           # Layout principal y navegación lateral
│   ├── MoverTool.tsx     # Herramienta para mover por tipo
│   ├── RenameTool.tsx    # Herramienta para renombrar
│   ├── VideoTool.tsx     # Conversión de videos a SD
│   ├── NormalizeTool.tsx # Normalización de volumen
│   ├── CollectionTool.tsx # Catálogos y fichas personalizadas
│   ├── WishlistView.tsx  # Wishlist con precios por tienda
│   ├── AnalogReplayTool.tsx # Canales, programas y programación de TV
│   ├── DownloadsTool.tsx # Gestor persistente de descargas
│   ├── collapseState.ts  # Persistencia de grupos colapsados (localStorage)
│   ├── main.tsx          # Entrada de React
│   ├── styles.css        # Sistema visual, modo claro/oscuro y diseño responsive
│   └── types.ts          # Contratos TypeScript de la API
├── eslint.config.js
├── test/                    # Pruebas de URLs, colecciones, scraping, imágenes, renombrado y programación analog
├── vite.config.ts
└── package.json
```

## Arquitectura y seguridad

La aplicación separa el renderer de las operaciones privilegiadas:

- `contextIsolation` está habilitado.
- `nodeIntegration` está deshabilitado.
- El renderer no tiene acceso directo a Node.js ni al sistema de archivos.
- `preload.cjs` expone únicamente las operaciones requeridas mediante `contextBridge`.
- Las solicitudes se procesan con handlers IPC en el proceso principal.
- Las rutas de los archivos que se mueven se validan para asegurar que pertenezcan al origen.
- El destino no puede ser igual al origen. Si es una subcarpeta, se excluye del escaneo y de la limpieza.
- Los nombres enviados al módulo de renombrado no pueden incluir rutas.
- Cada salto de una URL se valida contra localhost, credenciales embebidas, redes privadas y direcciones reservadas.
- La resolución DNS se vuelve a validar al establecer la conexión para reducir ataques de DNS rebinding.
- Las respuestas inspeccionadas por la resolución de URLs se limitan a 1 MB y tienen timeout.
- Las descargas no siguen redirecciones nuevas después de resolver y validar el destino.
- El renderer no recibe acceso general al portapapeles ni al sistema operativo, solo operaciones específicas.

### Datos locales sensibles

El gestor persiste su estado en `downloads.json` dentro de `app.getPath('userData')`. Este archivo puede contener URLs, rutas locales, una API key de Google Drive y contraseñas de extracción. No se sincroniza ni se transmite deliberadamente, pero cualquier usuario o proceso con acceso al perfil local podría leerlo.

### Dependencias conocidas

`handbrake-js` mantiene avisos de auditoría heredados de su dependencia `decompress`. Esta dependencia se usa durante la instalación para obtener HandBrakeCLI y no se expone a archivos proporcionados por el usuario. No existe actualmente una versión moderna de `handbrake-js` que elimine esos avisos sin dejar de ser compatible con Node.js 26.

## Solución de problemas

### La ventana aparece vacía

Ejecuta primero `npm run build` y luego `npm start`. Para desarrollo utiliza `npm run dev`, que inicia el servidor Vite antes de abrir Electron.

### Electron no puede acceder a una carpeta

Comprueba los permisos del sistema operativo y que la carpeta continúe existiendo. Algunas carpetas protegidas requieren permisos adicionales.

### Un archivo no se puede mover o renombrar

Verifica que no esté abierto en otra aplicación, que el usuario tenga permisos de escritura y que el destino no contenga un archivo bloqueado con el mismo nombre.

### Google Drive no detecta un archivo o carpeta

Comprueba que Google Drive API esté habilitada, que la API key esté configurada y restringida a esa API, y que el recurso esté compartido públicamente. Se reconocen enlaces `/file/d/{id}`, `open?id={id}` y `/folders/{id}`.

### Un video de YouTube no se reconoce

El reconocimiento depende de `yt-dlp`, que deja de funcionar cuando YouTube cambia su reproductor. La aplicación detecta estos fallos, intenta actualizar el binario automáticamente y vuelve a analizar el enlace. Si aun así aparece como "No encontrado", revisa la conexión a Internet y vuelve a analizarlo desde la pestaña Identificador.

### Una descarga no continúa

Algunos servidores no admiten solicitudes por rangos. En esos casos, reanudar puede comenzar nuevamente desde cero. Revisa también que el enlace no haya expirado y vuelve a analizarlo desde la pestaña Identificador.

### Un comprimido solicita contraseña

Usa la acción de contraseña en la descarga pendiente. También puedes asignar una contraseña individual o común antes de añadir enlaces a la cola.

### El buscador de imágenes no devuelve resultados en un motor

Algunos motores limitan las consultas automatizadas (Google sirve resultados solo con JavaScript y DuckDuckGo puede bloquear ciertas redes). Prueba con otro motor de la modal, por ejemplo Bing, Wikimedia Commons u Openverse (imágenes libres de más de 800 millones de archivos; respeta sus licencias al reutilizarlas).

## Licencia

Proyecto privado. Añade una licencia explícita antes de distribuirlo públicamente.

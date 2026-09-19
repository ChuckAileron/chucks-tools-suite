# CHUCK's Tools Suite

Aplicación de escritorio para Windows, macOS y Linux que reúne herramientas locales de gestión de archivos en una sola interfaz. Está construida con Electron, React, TypeScript y Vite.

Las operaciones sobre archivos locales se ejecutan en el equipo del usuario. Los módulos Bypass de URLs y Descargas realizan solicitudes a las URLs ingresadas y, cuando corresponde, a las APIs públicas de MediaFire o Google Drive.

> **Estado del proyecto:** Bypass de URLs y Descargas aparecen como **WIP** en el menú porque la compatibilidad con servicios externos requiere mantenimiento continuo.

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

> **Advertencia:** la opción para eliminar carpetas hijas borra recursivamente las subcarpetas y cualquier contenido que permanezca dentro de ellas. La carpeta de origen nunca se elimina. La interfaz solicita confirmación antes de ejecutar esta acción.

La carpeta de destino debe ser diferente de la carpeta de origen. Si está dentro del origen, se excluye automáticamente del escaneo y se conserva durante la limpieza de carpetas hijas.

El flujo de staging puede configurarse como: origen > destino temporal > limpieza opcional de carpetas hijas > devolución a la raíz del origen. La devolución aplana el lote en la raíz para no recrear las carpetas eliminadas. La acción Deshacer es distinta: restaura cada archivo en su ruta original y resuelve colisiones sin sobrescribir archivos.

La opción para eliminar el destino temporal solo aparece cuando la aplicación creó realmente una carpeta dentro del origen y está activada la devolución. La carpeta se elimina únicamente si quedó vacía; un destino preexistente nunca se elimina automáticamente.

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

Cada archivo se renombra dentro de su propia carpeta. La lógica está aislada en `electron/renameManager.cjs`, que valida que los nombres no contengan rutas para impedir salidas fuera de la carpeta de origen.

### Video a SD

Convierte videos a una resolución máxima de 480p y los guarda siempre como MP4, conservando los archivos originales.

Características:

- Selección de varias carpetas en una misma ejecución.
- Procesamiento de MP4, M4V, MOV, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, TS, MTS, M2TS, VOB, OGV, 3GP, 3G2 y ASF.
- Códec H.264 para máxima compatibilidad o H.265 para mayor compresión.
- Selección de pistas de audio y subtítulos en contenedores MKV.
- Conversión de pistas de audio seleccionadas a AAC de 128 kbps.
- Conversión de subtítulos de texto compatibles a `mov_text` para MP4.
- Exclusión visible de subtítulos basados en imagen, como PGS y VobSub.
- Progreso global y por archivo en tiempo real.
- Cancelación del proceso activo.
- Cola dinámica: permite añadir carpetas mientras la conversión está en curso.
- Eliminación de carpetas pendientes sin interrumpir la carpeta activa.
- Recálculo del progreso global cuando cambia la cola.
- Carpetas colapsables con selección persistente de pistas.
- Salida en `sd-output-h264` o `sd-output-h265` dentro de cada carpeta seleccionada.
- Sufijo `_SD` para evitar modificar o reemplazar los originales.
- Conversión mediante FFmpeg para los formatos principales y `handbrake-js` para las entradas adicionales.
- Todas las entradas se escriben como MP4 para obtener una salida uniforme.
- Aviso integrado sobre pérdida de detalle visual y compresión de audio.

Esta herramienta requiere que los ejecutables `ffmpeg` y `ffprobe` estén instalados y disponibles en la variable de entorno `PATH`.

### Normalizar volumen

Normaliza la sonoridad percibida de archivos de audio o de las pistas de audio contenidas en videos.

- Procesamiento de varias carpetas.
- Objetivo configurable entre -50 y -5 LUFS.
- Valor recomendado de -16 LUFS para contenido general.
- Progreso por archivo y cancelación del proceso activo.
- Video copiado sin recodificar para evitar pérdida visual y reducir el tiempo de proceso.
- Resultado guardado junto al original con el sufijo `_normalized`.
- Los archivos originales nunca se reemplazan.

La normalización utiliza el filtro `loudnorm` de FFmpeg. Los archivos ya terminados en `_normalized` se excluyen del siguiente escaneo para evitar procesarlos repetidamente.

### Colección

Permite crear catálogos locales con fichas personalizadas y persistencia SQLite.

- Múltiples colecciones con nombre, descripción y tipo.
- Columnas configurables de texto, número, booleano, fecha, URL o etiquetas.
- Campos obligatorios y validación de datos antes de guardar.
- Vista en tarjetas con imágenes remotas por URL HTTP o HTTPS.
- Búsqueda, edición y eliminación de ítems.
- Importación y exportación de cada colección en formato JSON.
- Base de datos guardada en el directorio local de datos de Electron.
- Wishlist con nombre, manufacturero, año y múltiples páginas de tienda por artículo.
- Consulta de precios mediante scraping local de JSON-LD, metadatos de producto y HTML.

### Bypass de URLs

Resuelve el destino de URLs cortas y páginas intermedias publicitarias sin abrirlas primero en el navegador.

- Sigue hasta 12 redirecciones HTTP y HTTPS.
- Detecta redirecciones `meta refresh`.
- Extrae destinos de parámetros codificados y patrones HTML habituales.
- Muestra el dominio final y la cadena completa de navegación.
- Permite copiar o abrir el resultado validado.
- Bloquea localhost, credenciales embebidas y direcciones privadas o reservadas.
- Limita cada respuesta a 1 MB y aplica tiempos máximos de espera.

La implementación utiliza `normalize-url`, `tldts` y `cheerio`. Los adaptadores HTML están aislados en `electron/urlResolver.cjs` para facilitar su mantenimiento cuando cambien los servicios. No se ejecuta JavaScript de terceros, no se resuelven CAPTCHA y no se evaden controles de autenticación o acceso.

### Gestor de descargas

Gestor inspirado en el flujo de JDownloader con una interfaz reducida a tres pestañas: Descargas, Identificador y Configuración.

- Captura opcional de uno o varios enlaces desde el portapapeles.
- Resolución previa de URLs cortas y páginas como MediaFire.
- Comprobación de disponibilidad antes de añadir a la cola.
- Carpeta de destino individual, múltiple o predeterminada.
- Prioridades urgente, alta, media y baja.
- Renombrado antes de descargar y mientras la tarea no esté activa.
- Cola persistente agrupada por carpeta de destino.
- Segundo nivel de agrupación por colección de enlaces.
- Nombre de colección editable y asignación común para múltiples enlaces.
- Expansión recursiva de carpetas públicas de MediaFire, conservando sus subcolecciones.
- Expansión recursiva de carpetas públicas de Google Drive mediante una API key.
- Detección de archivos individuales de Drive en formatos `/file/d/{id}` y `open?id={id}`.
- Exportación automática de Documentos, Hojas, Presentaciones y Dibujos de Google.
- De una a ocho descargas simultáneas.
- Pausa, reanudación y detención con conservación de archivos parciales.
- Progreso, tamaño y velocidad actual.
- Apertura del enlace original y localización del archivo descargado.
- Limpieza de tareas completadas.
- Extracción automática de ZIP, 7z, RAR, TAR, GZ, BZ2 y XZ.
- Contraseña previa por enlace y reintento cuando un comprimido la requiera.
- Detección de enlaces copiados configurable y limitada a una bandeja previa: copiar una URL no inicia una descarga automáticamente.

Las descargas utilizan `node-downloader-helper`. La extracción usa `7zip-min` con binarios multiplataforma. Las tareas y configuraciones se guardan en el directorio local de datos de Electron.

Google Drive requiere una API key con Google Drive API habilitada. La clave se configura localmente en la pestaña Configuración y conviene restringirla a esa API desde Google Cloud Console. MEGA se reconoce como colección, pero se mantiene como no descargable porque necesita un canal cifrado específico que no es compatible con el descargador HTTP reanudable. MediaFire dispone de expansión pública sin credenciales.

Para configurar Google Drive:

1. Crea o selecciona un proyecto en Google Cloud Console.
2. Habilita **Google Drive API** desde la biblioteca de APIs.
3. Crea una credencial de tipo **API key**.
4. Restringe la clave para que solo pueda utilizar Google Drive API.
5. Pega la clave en Descargas > Configuración > Google Drive.

Solo pueden enumerarse carpetas compartidas públicamente. No se solicitan permisos sobre la cuenta personal del usuario. La API key, las contraseñas de extracción, la cola y las preferencias se guardan localmente en el directorio de datos de Electron.

## Requisitos

- Node.js 26.9.0 o posterior.
- npm 11.19.1 o posterior.
- Un entorno de escritorio compatible con Electron.
- FFmpeg y FFprobe para utilizar el módulo Video a SD.
- Conexión a Internet para Bypass de URLs, Descargas y las integraciones con hosts externos.

HandBrakeCLI y 7-Zip se instalan mediante las dependencias `handbrake-js` y `7zip-min`; no requieren instalación manual independiente.

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

Cada plataforma debe empaquetarse desde su propio sistema operativo (o mediante CI multi-plataforma): electron-builder incluye solo los binarios nativos de la plataforma de origen. Los binarios de HandBrake y 7-Zip se extraen fuera del `app.asar` para poder ejecutarse en tiempo de ejecución.

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
│   ├── collectionManager.cjs # Colecciones y persistencia SQLite
│   ├── priceScraper.cjs     # Scraping de precios para la wishlist
│   ├── renameManager.cjs    # Listado y renombrado de archivos
│   ├── videoConversion.cjs  # Conversión FFmpeg/HandBrake
│   ├── urlResolver.cjs      # Resolución y validación segura de URLs
│   └── downloadManager.cjs  # Cola persistente y extracción
├── src/
│   ├── App.tsx           # Layout principal y navegación lateral
│   ├── MoverTool.tsx     # Herramienta para mover por tipo
│   ├── RenameTool.tsx    # Herramienta para renombrar
│   ├── VideoTool.tsx     # Conversión de videos a SD
│   ├── NormalizeTool.tsx # Normalización de volumen
│   ├── CollectionTool.tsx # Catálogos y fichas personalizadas
│   ├── WishlistView.tsx  # Wishlist con precios por tienda
│   ├── UrlBypassTool.tsx # Resolución de URLs cortas e intermedias
│   ├── DownloadsTool.tsx # Gestor persistente de descargas
│   ├── main.tsx          # Entrada de React
│   ├── styles.css        # Sistema visual y diseño responsive
│   └── types.ts          # Contratos TypeScript de la API
├── eslint.config.js
├── test/                    # Pruebas de URLs, colecciones, scraping y renombrado
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
- Las respuestas inspeccionadas por el bypass se limitan a 1 MB y tienen timeout.
- Las descargas no siguen redirecciones nuevas después de resolver y validar el destino.
- El renderer no recibe acceso general al portapapeles ni al sistema operativo, solo operaciones específicas.

### Datos locales sensibles

El gestor persiste su estado en `downloads.json` dentro de `app.getPath('userData')`. Este archivo puede contener URLs, rutas locales, una API key de Google Drive y contraseñas de extracción. No se sincroniza ni se transmite deliberadamente, pero cualquier usuario o proceso con acceso al perfil local podría leerlo.

### Dependencias conocidas

`handbrake-js` mantiene avisos de auditoría heredados de su dependencia `decompress`. Esta dependencia se usa durante la instalación para obtener HandBrakeCLI y no se expone a archivos proporcionados por el usuario. No existe actualmente una versión moderna de `handbrake-js` que elimine esos avisos sin dejar de ser compatible con Node.js 26.

## Flujo para agregar herramientas

1. Crear un componente dentro de `src/`.
2. Añadir las operaciones privilegiadas necesarias en `electron/main.cjs`.
3. Exponer una API mínima en `electron/preload.cjs`.
4. Declarar su contrato en `src/types.ts`.
5. Incorporar la opción al sidebar de `src/App.tsx`.
6. Ejecutar `npm run check` antes de integrar el cambio.

## Solución de problemas

### La ventana aparece vacía

Ejecuta primero `npm run build` y luego `npm start`. Para desarrollo utiliza `npm run dev`, que inicia el servidor Vite antes de abrir Electron.

### Electron no puede acceder a una carpeta

Comprueba los permisos del sistema operativo y que la carpeta continúe existiendo. Algunas carpetas protegidas requieren permisos adicionales.

### Un archivo no se puede mover o renombrar

Verifica que no esté abierto en otra aplicación, que el usuario tenga permisos de escritura y que el destino no contenga un archivo bloqueado con el mismo nombre.

### Google Drive no detecta un archivo o carpeta

Comprueba que Google Drive API esté habilitada, que la API key esté configurada y restringida a esa API, y que el recurso esté compartido públicamente. Se reconocen enlaces `/file/d/{id}`, `open?id={id}` y `/folders/{id}`.

### Una descarga no continúa

Algunos servidores no admiten solicitudes por rangos. En esos casos, reanudar puede comenzar nuevamente desde cero. Revisa también que el enlace no haya expirado y vuelve a analizarlo desde la pestaña Identificador.

### Un comprimido solicita contraseña

Usa la acción de contraseña en la descarga pendiente. También puedes asignar una contraseña individual o común antes de añadir enlaces a la cola.

## Licencia

Proyecto privado. Añade una licencia explícita antes de distribuirlo públicamente.

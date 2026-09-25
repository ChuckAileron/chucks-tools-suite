# CHUCK's Tools Suite

Aplicación de escritorio para Windows, macOS y Linux que reúne herramientas locales de gestión de archivos en una sola interfaz. Está construida con Electron, React, TypeScript y Vite.

Las operaciones sobre archivos locales se ejecutan en el equipo del usuario. El módulo de Descargas realiza solicitudes a las URLs ingresadas y, cuando corresponde, a las APIs públicas de MediaFire o Google Drive.

La interfaz incluye un botón **Modo claro / Modo oscuro** en la barra lateral, con la preferencia persistida localmente y sincronizada con `prefers-color-scheme` en el primer inicio. Toda la suite (Organizar, Renombrar, Cortar audio/video, Video a SD, Normalizar, Gestor de descargas, Colección, BinderTrack, AnalogReplayTV, Inventario HDD, Reproductor, Wishlist y los modales) se reeskinna al cambiar de tema; la barra lateral permanece con su croma oscuro característico en ambos modos.

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

Permite modificar los nombres de archivos o carpetas de una o varias rutas en una misma ejecución, organizado en tres pestañas: **Archivos**, **Carpetas** y **Crear nombres**.

Características comunes a Archivos y Carpetas:

- Selección de varias carpetas (o una sola) con "Añadir carpetas", limpieza y eliminación individual.
- Vista previa del resultado antes de aplicar cambios, mostrando la carpeta de origen cuando hay varias.
- Búsqueda y reemplazo de texto.
- Reemplazo desde el inicio hasta incluir un texto determinado.
- Reemplazo desde un texto determinado, incluyéndolo, hasta el final.
- Adición de prefijos y sufijos.
- Botón de limpiar (×) en cada campo de transformación para vaciarlo rápidamente.
- Selección individual o global de archivos o carpetas.
- La pestaña **Archivos** conserva la extensión original; la pestaña **Carpetas** transforma el nombre completo, ya que las carpetas no tienen extensión.

#### Crear nombres

Genera una tabla temporal (vive solo mientras se navega dentro de Renombrar archivos) para construir nombres combinando varias columnas de datos:

- Selección de **Archivos** o **Carpetas** y de una o varias carpetas de origen, igual que en las otras pestañas.
- Botón **+ Agregar columna nombre**: crea una columna editable con un cuadro de texto donde se pega un listado de nombres, uno por línea; cada línea corresponde a la fila en el mismo orden que los archivos o carpetas listados.
- La tabla se muestra como una grilla con el nombre original, cada columna de nombres agregada y el nombre nuevo resultante por fila.
- Casilla **Combinar nombres**: al activarla aparecen los campos de "prefijo de unión" que se insertan antes del valor de cada columna al construir el nombre nuevo.
- Con más de una columna nombre, una casilla adicional permite **usar el mismo prefijo de unión** para todas; si se desactiva, se define un prefijo independiente por columna.
- Ejemplo: `nombrearchivo.txt` + columna 1 ("valor 1", prefijo `" "`) + columna 2 ("valor 2", prefijo `"-X-"`) → `nombrearchivo valor 1-X-valor 2.txt`.
- Columnas renombrables y eliminables de forma independiente; renombrado final aplicado solo a las filas seleccionadas y con cambios reales.

### Cortar audio/video

Recorta audio o video con FFmpeg local, conservando siempre los archivos originales.

- Procesamiento de varias carpetas en una misma ejecución, con tipo de contenido (audio o video) por lote.
- Modo **Conservar sección**: descarta todo lo que quede fuera del rango indicado.
- Modo **Eliminar sección**: quita el rango y conserva el resto.
- Recorte interior (cuando el tramo no toca ni el inicio ni el final) con la casilla **Separar en dos archivos** para conservar los dos segmentos; si se desactiva, ambos tramos se unen en uno solo.
- Tiempos ingresables en segundos, `mm:ss` o `h:mm:ss`, con validación de rango por archivo y descripción del resultado antes de procesar.
- Progreso global y por archivo, cancelación del proceso activo, indicador ✓ en archivos terminados y registro de actividad en pantalla.
- Una carpeta solo puede quitarse de la cola mientras no se esté procesando uno de sus archivos.
- Salida en `trimmed_output-audio` o `trimmed_output-video` dentro de cada carpeta; los originales nunca se modifican.

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
- El listado muestra el LUFS medido de cada archivo (se mide en segundo plano con FFmpeg tras explorar, sin bloquear la interfaz), en lotes acotados en paralelo según los núcleos disponibles del equipo. En archivos de más de 45 segundos, la medición para el listado se hace sobre un extracto de 30 segundos (saltando el primer 10% para evitar intros o silencios) en lugar de todo el archivo, para que se calcule mucho más rápido; la corrección aplicada al normalizar de verdad sigue midiéndose sobre el archivo completo.
- Mientras se calcula el LUFS aparece un indicador con cuántos archivos ya se midieron sobre el total y la duración de la muestra usada, con la opción de cancelar el análisis en cualquier momento.
- El botón "Normalizar" permanece deshabilitado hasta que termine de calcularse el LUFS de todos los archivos listados (o se cancele el análisis), para asegurar que la decisión de omitir archivos ya en el objetivo se tome con datos completos.
- Si el LUFS de un archivo ya está a 1 LU o menos del objetivo configurado, se marca como "en el objetivo" en el listado y su procesamiento se omite automáticamente al normalizar (no se reprocesa un archivo que ya cumple, dentro de una pequeña tolerancia por no ser mediciones exactas).

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

#### Metadata LaunchBox

La pestaña **Metadata LaunchBox** busca la metadata de juegos en el GamesDB de LaunchBox (`gamesdb.launchbox-app.com`) y la aplica a los ítems de la colección o los crea directamente.

- Mapeo de columnas de la colección (plataforma, fecha de lanzamiento, publisher y developer) con detección automática por etiqueta.
- Búsqueda individual por nombre y plataforma. La plataforma se elige con un selector con buscador que incluye las 190 plataformas registradas en el GamesDB (con el ícono de la plataforma cuando está disponible y navegación por teclado), aunque también acepta texto libre como antes.
- Al procesar por CSV se avisa primero qué registros no coinciden exactamente (nombre + plataforma) con la colección, para no buscar metadata de juegos que no existen en ella.
- Búsqueda por CSV con progreso en tiempo real y cancelación; los resultados se muestran en una tabla con estado, título, lanzamiento, publisher y developer.
- Exportación de los resultados a CSV y aplicación directa a la colección; también se puede aplicar un CSV de resultados previamente guardado.
- Si el juego encontrado no está en la colección, se ofrece agregarlo a una o varias colecciones a la vez con su metadata y su imagen de portada.
- El CSV se importa/exporta sin dependencias externas (parser y serializer propios, robustos ante comas, comillas, BOM y CRLF, con soporte de headers en español e inglés).

### BinderTrack

Mantenedor TCG compatible con la app móvil BinderTrack, para inventariar y administrar una colección de cartas con persistencia SQLite local. La interfaz se organiza en cuatro pestañas: **Series y sets**, **Cartas**, **Listas personalizadas** e **Importar / Exportar**.

- **Series y sets**: creación, edición y eliminación de sets con nombre, serie y subserie, fecha de lanzamiento, fabricante, imágenes (logo, packs, caja, símbolo, misceláneas), opción "considera variantes" y marcado de completado; filtrado por serie.
- **Cartas**: número, código, nombre, rareza, tipo, ilustrador, idioma, descripción, imagen, cantidad poseída, categoría personalizada y marca de promo, organizadas por set.
  - **Variantes** por carta (tipo, rareza, imagen y poseídas) editables en línea desde la fila expandida de cada carta.
- **Listas personalizadas**: listas con nombre, estado ("en progreso"/"completado") y color, con búsqueda de cartas por nombre para añadirlas y reordenación (▲/▼) o eliminación de entradas.
- **Importar / Exportar**: intercambio con la app móvil mediante archivos ZIP. Al importar, los sets que ya existen se reemplazan (quedan en 0 copias, listos para inventariar) y las listas se agregan sin sobrescribir datos existentes; se puede exportar la colección completa, un set o una lista.
- Integración con la sección **Colección**: volcado de una carta o de todas las cartas de un set como ítems de una colección genérica ya existente.

La base de datos (`bindertrack.sqlite`) y las imágenes que la app móvil envía en los ZIP importados (carpeta `bindertrack-media/`) se guardan en el directorio local de datos de Electron; no se sincronizan con ningún servicio externo.

### ChuckBot

Asistente de IA local que habla con modelos de [Ollama](https://ollama.com) a través del backend Go de ChuckBot (`http://localhost:8374`). La suite gestiona automáticamente el ciclo de vida de `chuckbot.exe` (empaquetado en `vendor/chuckbot`) y del servidor de Ollama.

- **Chat con modelos locales**: `qwen2.5:latest` (chat general), `sqlcoder:latest` (SQL) o modo **multi-agente** que reparte el trabajo entre ambos; los eventos se muestran en vivo (tokens, pasos, archivo solución, errores).
- **Encendido persistente**: el bot siempre aparece apagado al entrar a la sección y nada se inicia por sí solo; primero hay que pulsar **Iniciar servidor** y luego **Encender Ollama**. Una vez encendidos, el estado se conserva al navegar entre secciones y solo se apaga si el usuario lo hace o al cerrar el programa. El estado de ambos se refleja con indicadores en vivo y poll cada 4 segundos; la conversación también se mantiene al cambiar de sección (se descarta al salir de la aplicación).
- **Archivos como contexto**: botón "Adjuntar archivos" con límite de 256 KB por archivo; el contenido se envía junto al mensaje.
- **Archivo solución**: con el modo "solución (proyecto)" activado, la respuesta se genera como un archivo de software completo (con una "receta" de implementación) que se muestra en un panel para **guardarlo en la carpeta del proyecto**.
- **Enviar a VS Code**: guarda el archivo solución en disco y lo abre en VS Code mediante la extensión **Remote Control** ([eliostruyf.vscode-remote-control](https://marketplace.visualstudio.com/items?itemName=eliostruyf.vscode-remote-control)), conectando por websocket al puerto que muestra la barra de estado de VS Code (por defecto 3710, configurable en la herramienta).

Requisitos del módulo: instalar Ollama y descargar los modelos (`ollama pull qwen2.5:latest`, `ollama pull sqlcoder:latest`), e instalar la extensión Remote Control en VS Code solo si se quiere el envío directo.

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
- Soporte de **MEGA** (archivos y carpetas) sin cuenta ni dependencias externas: el archivo se descarga cifrado y se descifra en el equipo (AES-CTR por chunks) usando la clave incluida en el enlace; las carpetas se recorren enumerando y descifrando cada nodo con la clave de la carpeta.
- Soporte de **TeraBox** (enlaces compartidos de archivo o carpeta) mediante el flujo anónimo de verificación y listado de la web; TeraBox puede requerir reintentos o dejar de responder si cambia su protección anti-scraping.
- Botón **Mostrar carpeta** en el encabezado de cada grupo para abrir la carpeta destino en el explorador.
- Botones globales **Pausar todo**, **Continuar todo** y **Detener todo** en la barra de descargas, que actúan sobre todas las tareas de la lista con la lógica de selección por estado ya existente.
- Modal **Listar enlaces** desde la barra de descargas: muestra todas las URLs en cola, una por línea, con "Copiar todos" al portapapeles y "Cerrar".
- Indicador en vivo del espacio del disco predeterminado (C: en Windows, raíz en macOS/Linux) con tamaño total y libre, refrescado cada 30 segundos.
- En **Configuración > Automatización** aparece la casilla **Eliminar comprimidos tras extraer** (activada por defecto), que se aplica a cada nuevo candidato identificado y puede ajustarse individualmente por enlace.
- Expansión recursiva de carpetas públicas de Google Drive. Las carpetas y archivos públicos se enumeran sin clave mediante la vista web; con API key además se exportan los documentos de Google (Docs, Sheets...) y se evita el límite de descarga anónimo.
- Detección de páginas de error de Google Drive (cuota superada o aviso de escaneo): en vez de guardar el HTML como si fuera el archivo, la tarea se marca como fallida con un mensaje claro y se eliminan los descartados de carga.
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

Google Drive es opcional: las carpetas y archivos compartidos públicamente se enumeran sin necesidad de configuración. La API key con Drive API habilitada (Descargas > Configuración) sirve para exportar documentos de Google y para evitar el límite de descargas anónimo de archivos grandes. No se solicitan permisos sobre la cuenta personal del usuario.

Para configurar Google Drive (opcional, solo si se quiere exportar documentos o elevar el límite de descargas):

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

### Inventario HDD

Cataloga el contenido completo de discos duros externos en una base de datos local, con miniaturas y ficha técnica por archivo, similar en espíritu a MediaInfo.

- Selección de la carpeta raíz del disco (por ejemplo `D:\`) y asignación de un identificador de texto propio, como `HDD-001`, más un nombre descriptivo opcional.
- El barrido ("Analizar HDD") recorre recursivamente el disco y guarda la ruta completa de cada archivo y carpeta en la base de datos, junto con tamaño, fecha de modificación y categoría (video, foto, audio, documento u otro).
- Reconocimiento del disco por un identificador de volumen estable (no por la letra de unidad): un HDD registrado se detecta como "conectado" aunque el sistema operativo lo monte en D:, E:, F:, etc. en una conexión posterior.
- Miniaturas automáticas para video, fotos y documentos generadas y guardadas durante el análisis: fotograma intermedio para video, imagen redimensionada para fotos y, para documentos, la primera página del PDF (si hay Poppler/`pdftoppm` disponible) o un marcador genérico con la extensión.
- Las miniaturas se regeneran solo cuando la fecha de modificación del archivo cambió desde el último análisis.
- Campo dinámico `media_properties` (JSON) con las propiedades técnicas de archivos multimedia extraídas con FFprobe (contenedor, códecs, resolución, duración, bitrate, pistas, etc.), visible desde la ficha de cada archivo.
- Botón "Analizar HDD" para re-escanear en cualquier momento: actualiza archivos nuevos o modificados, elimina del catálogo los que ya no existen en el disco y conserva sin cambios los que siguen igual.
- Renombrado de archivos y carpetas: siempre se actualiza la base de datos; una casilla adicional (desactivada y bloqueada si el HDD no está conectado) permite aplicar el cambio también al archivo o carpeta real.
- Al renombrar una carpeta, se actualizan en cascada las rutas de todo su contenido en la base de datos, con aviso previo del número de elementos afectados antes de confirmar.

El catálogo, las miniaturas y las propiedades técnicas se guardan en el directorio local de datos de Electron; no se sincronizan ni se transmiten a ningún servicio externo.

### Reproductor

Reproduce el contenido catalogado en Inventario HDD directamente desde el disco conectado, sin importar ni copiar archivos.

- Se abre con el botón **▶ Reproducir** de un archivo en Inventario HDD y mantiene un botón **← Volver a Inventario HDD** en el reproductor.
- Los archivos se sirven mediante el protocolo privilegiado `hddmedia://` con soporte de rangos (Range), lo que permite búsqueda (seek) en video y audio sin cargar el archivo completo.
- **Video**: reproductor con controles y reproducción.
- **Audio**: reproductor con barra de búsqueda y controles de salto.
- **Imágenes**: galería con las demás imágenes de la misma carpeta y visor a pantalla completa (lightbox) con zoom.
- **Documentos**: extracción y lectura del texto dentro de la aplicación (PDF, Word, Excel, PowerPoint, OpenDocument, RTF y texto plano).
- Si el disco está desconectado, el reproductor lo indica y no reproduce el contenido hasta reconectar el HDD.

## Requisitos

- Node.js 26.9.0 o posterior.
- npm 11.19.1 o posterior.
- FFmpeg y FFprobe para los módulos Video a SD, Cortar audio/video y para las miniaturas/ficha técnica de Inventario HDD.
- Poppler (`pdftoppm`) opcional, para generar miniaturas reales de la primera página de archivos PDF en Inventario HDD; sin él se usa un marcador genérico.
- Conexión a Internet para Descargas, el buscador de imágenes y la metadata de juegos de Colección, y las integraciones con hosts externos.
- Ollama con los modelos `qwen2.5:latest` y `sqlcoder:latest` para la herramienta **ChuckBot**.

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
│   ├── binderTrack.cjs      # Base de datos BinderTrack e importación/exportación ZIP
│   ├── collectionManager.cjs # Colecciones y persistencia SQLite
│   ├── launchboxMetadata.cjs # Metadata del GamesDB de LaunchBox (búsqueda y CSV)
│   ├── imageSearch.cjs      # Búsqueda de imágenes (Bing, Google, DuckDuckGo, Wikimedia, Openverse)
│   ├── priceScraper.cjs     # Scraping de precios para la wishlist
│   ├── renameManager.cjs    # Listado y renombrado de archivos
│   ├── videoConversion.cjs  # Conversión FFmpeg/HandBrake
│   ├── videoProvider.cjs    # Identificación y descarga de videos con yt-dlp
│   ├── urlResolver.cjs      # Resolución y validación segura de URLs
│   ├── clipboardWatcher.cjs # Detección de enlaces copiados
│   ├── downloadManager.cjs  # Cola persistente y extracción
│   ├── hddInventory.cjs     # Catálogo de discos, miniaturas y ficha técnica
│   ├── mediaPlayer.cjs      # Protocolo hddmedia:// y visor de texto de documentos
│   ├── megaProvider.cjs     # Descarga y descifrado de enlaces MEGA (AES-CTR)
│   ├── teraboxProvider.cjs  # Enlaces compartidos de TeraBox
│   ├── chuckbot.cjs         # Ciclo de vida de chuckbot.exe, proxy de chat/SSE y envío a VS Code
│   └── trim.cjs             # Recorte de audio/video con FFmpeg
├── src/
│   ├── App.tsx           # Layout principal y navegación lateral
│   ├── MoverTool.tsx     # Herramienta para mover por tipo
│   ├── RenameTool.tsx    # Herramienta para renombrar
│   ├── TrimTool.tsx      # Cortar audio/video
│   ├── VideoTool.tsx     # Conversión de videos a SD
│   ├── NormalizeTool.tsx # Normalización de volumen
│   ├── CollectionTool.tsx # Catálogos, metadata LaunchBox y fichas personalizadas
│   ├── LaunchBoxMetadataPanel.tsx # Búsqueda y aplicación de metadata de juegos
│   ├── LaunchboxPlatformSelect.tsx # Selector de plataforma con buscador
│   ├── launchboxPlatforms.json # Las 190 plataformas del GamesDB de LaunchBox
│   ├── BinderTrackTool.tsx # Mantenedor de colección TCG
│   ├── ChuckBotTool.tsx    # Chat con IA local (Ollama) y archivos solución
│   ├── WishlistView.tsx  # Wishlist con precios por tienda
│   ├── AnalogReplayTool.tsx # Canales, programas y programación de TV
│   ├── DownloadsTool.tsx # Gestor persistente de descargas
│   ├── MediaPlayerTool.tsx # Reproductor de medios del Inventario HDD
│   ├── HddInventoryTool.tsx # Inventario y explorador de discos duros
│   ├── mediaUrl.ts       # URLs del protocolo hddmedia://
│   ├── collapseState.ts  # Persistencia de grupos colapsados (localStorage)
│   ├── main.tsx          # Entrada de React
│   ├── styles.css        # Sistema visual, modo claro/oscuro y diseño responsive
│   └── types.ts          # Contratos TypeScript de la API
├── eslint.config.js
├── test/                    # Pruebas de URLs, descargas, MEGA/TeraBox, recorte, colecciones (con metadata LaunchBox), imágenes, renombrado, inventario HDD y BinderTrack
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

Inventario HDD guarda su catálogo en `hdd-inventory.sqlite` y sus miniaturas en la carpeta `hdd-thumbnails/`, ambos dentro de `app.getPath('userData')`. Contienen rutas completas del disco, nombres de archivos y miniaturas de su contenido; se mantienen únicamente en el equipo local.

BinderTrack guarda su catálogo en `bindertrack.sqlite` y las imágenes importadas desde la app móvil en `bindertrack-media/`, ambos dentro de `app.getPath('userData')`. Contienen datos de la colección de cartas editados por el usuario; se mantienen únicamente en el equipo local.

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

Comprueba que el archivo o carpeta esté compartido públicamente (para descargas anónimas) o que la API key esté configurada y restringida a Google Drive API. Si el recurso está dentro del límite de cuota anónima de Google, aparecerá el mensaje de "cuota superada": reintenta más tarde (el límite puede tardar hasta 24 h en liberarse). Se reconocen enlaces `/file/d/{id}`, `open?id={id}` y `/folders/{id}`.

### Un video de YouTube no se reconoce

El reconocimiento depende de `yt-dlp`, que deja de funcionar cuando YouTube cambia su reproductor. La aplicación detecta estos fallos, intenta actualizar el binario automáticamente y vuelve a analizar el enlace. Si aun así aparece como "No encontrado", revisa la conexión a Internet y vuelve a analizarlo desde la pestaña Identificador.

### Una descarga no continúa

Algunos servidores no admiten solicitudes por rangos. En esos casos, reanudar puede comenzar nuevamente desde cero. Revisa también que el enlace no haya expirado y vuelve a analizarlo desde la pestaña Identificador.

### Un comprimido solicita contraseña

Usa la acción de contraseña en la descarga pendiente. También puedes asignar una contraseña individual o común antes de añadir enlaces a la cola.

### El buscador de imágenes no devuelve resultados en un motor

Algunos motores limitan las consultas automatizadas (Google sirve resultados solo con JavaScript y DuckDuckGo puede bloquear ciertas redes). Prueba con otro motor de la modal, por ejemplo Bing, Wikimedia Commons u Openverse (imágenes libres de más de 800 millones de archivos; respeta sus licencias al reutilizarlas).

### Un HDD registrado aparece como "Desconectado"

La detección usa un identificador estable de volumen (no la letra de unidad), así que un mismo disco puede montarse en D:, E:, F:, etc. sin problema. Si de todos modos aparece desconectado, confirma que el disco esté realmente conectado y montado por Windows; en macOS/Linux la reconexión se valida por ruta de montaje, así que asegúrate de que el disco se monte en la misma ruta que en el registro original.

### Analizar HDD no genera miniaturas ni ficha técnica

Las miniaturas y las propiedades técnicas dependen de FFmpeg/FFprobe en el PATH del sistema. Los PDFs usan además `pdftoppm` (Poppler) si está disponible; sin él, los documentos reciben un marcador genérico con la extensión en vez de una vista previa real de la página.

## Licencia

Proyecto privado. Añade una licencia explícita antes de distribuirlo públicamente.

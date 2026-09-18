# CHUCK's Tools Suite

Aplicación de escritorio para Windows, macOS y Linux que reúne herramientas locales de gestión de archivos en una sola interfaz. Está construida con Electron, React, TypeScript y Vite.

Todos los archivos se procesan en el equipo del usuario. La aplicación no sube información ni requiere servicios externos para funcionar.

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

> **Advertencia:** la opción para eliminar carpetas hijas borra recursivamente las subcarpetas y cualquier contenido que permanezca dentro de ellas. La carpeta de origen nunca se elimina. La interfaz solicita confirmación antes de ejecutar esta acción.

La carpeta de destino debe ser diferente de la carpeta de origen y no puede encontrarse dentro de ella.

### Renombrar archivos

Permite modificar los nombres de los archivos del nivel principal de una carpeta.

Características:

- Búsqueda y reemplazo de texto.
- Adición de prefijos y sufijos.
- Vista previa del resultado antes de aplicar cambios.
- Selección individual o global de archivos.
- Conservación de la extensión original.

## Requisitos

- Node.js 20 o posterior.
- npm 10 o posterior.
- Un entorno de escritorio compatible con Electron.

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

Ejecutar lint, comprobación de formato y build en secuencia:

```bash
npm run check
```

## Estructura

```text
CHUCK's Tools Suite/
├── electron/
│   ├── main.cjs          # Ventana, IPC y operaciones del sistema de archivos
│   └── preload.cjs       # API segura expuesta al renderer
├── src/
│   ├── App.tsx           # Layout principal y navegación lateral
│   ├── MoverTool.tsx     # Herramienta para mover por tipo
│   ├── RenameTool.tsx    # Herramienta para renombrar
│   ├── main.tsx          # Entrada de React
│   ├── styles.css        # Sistema visual y diseño responsive
│   └── types.ts          # Contratos TypeScript de la API
├── eslint.config.js
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
- El destino se valida para evitar que sea igual o interno a la carpeta de origen.
- Los nombres enviados al módulo de renombrado no pueden incluir rutas.

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

## Licencia

Proyecto privado. Añade una licencia explícita antes de distribuirlo públicamente.

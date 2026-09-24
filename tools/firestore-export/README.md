# firestore-export

Herramienta de **un solo uso** para sacar una foto del sistema viejo (Firestore) a
archivos JSON. Se corre en tu máquina. No forma parte de la API ni del frontend:
el cargador del padrón va a leer los archivos que este script produce, nunca va a
hablar con Firestore.

Por qué así: el archivo es una foto congelada, se puede inspeccionar y re-procesar
cuantas veces haga falta; la app nunca necesita credenciales del sistema viejo; y
el dry-run del cargador se puede probar con archivos de ejemplo.

## ⚠️ Los archivos exportados NO se versionan

`output/` contiene nombres, teléfonos y deudas de clientes reales. Está en el
`.gitignore` del paquete y **nunca** se sube a Git, ni se pega en un chat, ni se
comparte por correo. Si lo movés a otra carpeta, mantené la misma regla.

## 1. Credenciales: las de gcloud, sin bajar ninguna llave

La herramienta **solo lee** Firestore (nunca escribe: lo único que ve el resto
del script es un adaptador de lectura, `readOnly` en `src/firestore.ts`) y usa
las **credenciales por defecto de la aplicación** (ADC) de tu usuario de Google.
No hace falta bajar la clave privada de un service account, que es una llave
de larga vida que después hay que cuidar y borrar.

Una sola vez en tu máquina:

```bash
gcloud auth application-default login
```

Tu usuario tiene que poder leer Firestore en el proyecto del sistema viejo,
`yacco-2026`. Si no puede, el export corta con el error de permisos de Google.

### Opcional: otra identidad

Si hace falta usar otra (por ejemplo, un service account), apuntá
`GOOGLE_APPLICATION_CREDENTIALS` a su archivo JSON y ADC lo usa en lugar de tu
usuario. Si la variable apunta a un archivo que no existe, el script corta con
un mensaje claro. **Nunca imprime la ruta ni el contenido**, tampoco en un
error: si un error del SDK nombra el archivo, sale tachado.

## 2. Proyecto

Por defecto lee `yacco-2026`. Para otro: `-- --project <id>` o la variable
`YACCO_FIRESTORE_PROJECT`.

## 3. Instalar (una sola vez, desde la raíz del repo)

```bash
pnpm install
```

## 4. Exportar

Desde `tools/firestore-export/`:

```bash
# Clientes -> output/customers.json
pnpm export:customers

# Vouchers con deuda pendiente (por defecto) -> output/vouchers.json
# Cada voucher lleva adentro su subcolección debtPays.
pnpm export:vouchers

# Todos los vouchers, no solo los pendientes
pnpm export:vouchers -- --all

# Otro directorio de salida
pnpm export:customers -- --out "C:\Users\User\privado\foto"

# Otro proyecto de Firebase
pnpm export:customers -- --project otro-proyecto
```

Al terminar, la consola muestra **solo cuántos documentos** exportó de cada
colección. Nunca vuelca contenido.

## Qué hace con los datos (y qué no)

Saca los documentos **tal como están**. Solo convierte los tipos que JSON no
puede representar, de forma explícita (`src/convert.ts`):

| Firestore        | JSON                                   |
| ---------------- | -------------------------------------- |
| `Timestamp`      | string ISO-8601 en UTC                 |
| número           | tal cual                               |
| `GeoPoint`       | `{ latitude, longitude }`              |
| bytes            | string base64                          |
| referencia a doc | `{ "_referencePath": "coleccion/id" }` |
| mapas y arreglos | recursivo                              |

Cada documento sale como `{ "id": "<id de Firestore>", "data": { ...campos } }`.

**No limpia, no valida, no renombra.** Eso es trabajo del cargador, sobre el
archivo. Este script solo saca la foto.

### Criterio de "deuda pendiente"

Todavía no está confirmado si el saldo pendiente de un voucher es
`total − debtPaid` o `total − suma(debtPays.amount)`. El criterio vive en **una
sola función**, `hasPendingDebt` en `src/pending-debt.ts`, con las dos lecturas
comentadas. Cuando se confirme contra datos reales, se corrige ahí y en ningún
otro lugar.

## Tests

```bash
pnpm test
```

Prueban el conversor de tipos, el criterio de deuda pendiente, los exportadores
(con un Firestore falso en memoria), el parseo de argumentos, la CLI con sus
dependencias inyectadas, la conexión con un firebase-admin falso y que el
adaptador no deje alcanzar ningún método de escritura. **Nunca** se conectan a
Firestore.

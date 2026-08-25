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

Lo mismo para el archivo del service account (ver abajo): es una llave privada.

## 1. Obtener el service account de Firebase

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) y
   abrí el proyecto del sistema viejo.
2. Engranaje (arriba a la izquierda) → **Configuración del proyecto**.
3. Pestaña **Cuentas de servicio**.
4. Botón **Generar nueva clave privada** → **Generar clave**. Se descarga un
   archivo `.json` (nombre parecido a `nombre-proyecto-firebase-adminsdk-xxxxx.json`).
5. Guardalo en una carpeta **fuera del repositorio**, por ejemplo
   `C:\Users\User\privado\serviceAccount.json`. No lo renombres a nada que
   termine en `.json` dentro de este repo.

## 2. Indicar dónde está la clave

El script lee la ruta de la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS`.
Nunca imprime ni la ruta ni el contenido.

PowerShell (vale solo para esa ventana):

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\User\privado\serviceAccount.json"
```

Git Bash:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/c/Users/User/privado/serviceAccount.json"
```

Si falta la variable o el archivo no existe, el script se detiene con un mensaje
que lo dice.

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
(con un Firestore falso en memoria) y el parseo de argumentos. **Nunca** se
conectan a Firestore.

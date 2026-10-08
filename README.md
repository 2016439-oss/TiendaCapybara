# 🦫 Tienda Capybara

Sistema web para una tienda que vende **únicamente merch de capibaras**. Backend con **FastAPI + SQLite** y frontend en HTML, CSS y JavaScript. Sigue la estructura del proyecto del taller mecánico (identificadores de texto, factura con tabla intermedia, API genérica por tabla) adaptada a una tienda con inventario y sucursales.

## Descripción
- Catálogo con filtro por categoría y búsqueda.
- Pantalla de compra: factura, artículos, descuento de stock y total en una sola transacción.
- CRUD completo de clientes, vendedores, categorías, productos, sucursales y facturas desde pestañas.
- Flujo real: **Frontend → API FastAPI → SQLite**. Los datos no están escritos en el frontend.

## Tecnologías
Python 3.10+, FastAPI, SQLite (`sqlite3`), HTML/CSS/JavaScript, GitHub y Vercel.

## Instalación
```bash
python -m venv venv
venv\Scripts\activate          # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
```

## Ejecución
```bash
uvicorn main:app --reload
```
Abre <http://127.0.0.1:8000>. Documentación interactiva de la API: <http://127.0.0.1:8000/docs>.

Al arrancar, la API crea las tablas y carga datos iniciales si la base está vacía. Para reiniciar la base, borra `tienda_capybara.db` y vuelve a ejecutar.

## Estructura
```
TiendaCapybara/
├── main.py                # API FastAPI (modelos, CRUD genérico y reglas de compra)
├── database.py            # Esquema SQLite, datos iniciales y conexión
├── tienda_capybara.db     # Base de datos SQLite
├── requirements.txt
├── public/                # Frontend
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── docs/                  # Análisis, diagrama ER y descripción de tablas
```

## Endpoints
| Método | Ruta | Acción |
|---|---|---|
| GET | `/api/{tabla}` | Listar |
| GET | `/api/{tabla}/{llave}` | Consultar uno |
| POST | `/api/{tabla}` | Crear |
| PUT | `/api/{tabla}/{llave}` | Actualizar |
| DELETE | `/api/{tabla}/{llave}` | Eliminar |
| GET | `/api/factura/{id}/detalle` | Factura con sus artículos y total |
| POST | `/api/compra` | Registrar una compra completa (crea la factura) |
| GET | `/api/resumen` | Totales y productos con stock bajo |

Tablas: `cliente`, `vendedor`, `categoria`, `producto`, `sucursal`, `factura` y la intermedia `factura_producto` (su llave lleva dos partes: `/api/factura_producto/FAC-0001/P-001`).

Errores: 404 no existe, 409 duplicado / stock insuficiente / registro en uso, 422 datos inválidos.

## Base de datos
Diagrama y descripción de tablas en [`docs/ANALISIS.md`](docs/ANALISIS.md).

![ER](docs/diagrama_er.png)

## Publicación en Vercel
Sube el repositorio a GitHub, impórtalo en vercel.com (Add New → Project) y pulsa Deploy.
> En Vercel el disco es de solo lectura salvo `/tmp`, así que la base se copia allí y los cambios pueden reiniciarse cuando la instancia se reinicia. En local los datos son permanentes.

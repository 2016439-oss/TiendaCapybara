# Tienda Capybara

Sistema web para una tienda que vende **únicamente merch de capibaras** y trabaja por pedido: el cliente elige el tipo de merch, la cantidad, el color, el accesorio y el lugar donde lo retira. Backend con **FastAPI + SQLite** y frontend en HTML, CSS y JavaScript. Sigue la estructura del proyecto del taller mecánico (identificadores de texto, API genérica por tabla, pestañas con CRUD).

## Descripción
- Pantalla de **Compra**: registra el pedido y la API calcula el total.
- **Pedidos**: consulta con detalle, edición y borrado.
- CRUD de clientes, vendedores, lugares de retiro, tipos de merch, colores y accesorios.
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

Al arrancar, la API crea las tablas y carga datos iniciales si la base está vacía. Si encuentra una base de una versión anterior del esquema, la guarda como `tienda_capybara_anterior.db` y crea una nueva. Para reiniciar los datos, borra `tienda_capybara.db`.

## Estructura
```
TiendaCapybara/
├── main.py                # API FastAPI (modelos, CRUD genérico y cálculo del total)
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
| GET | `/api/pedido/{id}/detalle` | Pedido con los nombres de cliente, merch, color, accesorio y lugar de retiro |
| POST | `/api/compra` | Registrar una compra (crea el pedido con identificador, fecha y total) |
| GET | `/api/resumen` | Pedidos, unidades y total facturado |

Tablas: `cliente`, `vendedor`, `sucursal`, `merch`, `color`, `accesorio` y `pedido`.

Errores: 404 no existe, 409 duplicado o registro en uso, 422 datos inválidos.

## Base de datos
Diagrama y descripción de tablas en [`docs/ANALISIS.md`](docs/ANALISIS.md).

![ER](docs/diagrama_er.png)

## Publicación en Vercel
Sube el repositorio a GitHub, impórtalo en vercel.com (Add New → Project) y pulsa Deploy.
> En Vercel el disco es de solo lectura salvo `/tmp`, así que la base se copia allí y los cambios pueden reiniciarse cuando la instancia se reinicia. En local los datos son permanentes.

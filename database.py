"""Esquema y utilidades de SQLite para la Tienda Capybara."""
from contextlib import contextmanager
from pathlib import Path
import os
import shutil
import sqlite3

BASE_DIR = Path(__file__).resolve().parent
SOURCE_DB = BASE_DIR / "tienda_capybara.db"
# Vercel solo permite escribir en /tmp, así que allí se trabaja con una copia de la base.
DB_PATH = Path("/tmp/tienda_capybara.db") if os.environ.get("VERCEL") else SOURCE_DB
# Cambia cuando se modifica el esquema; así una base antigua se respalda en vez de provocar errores.
SCHEMA_VERSION = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS cliente (
  cedula TEXT PRIMARY KEY, nombre TEXT NOT NULL, apellidos TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE, telefono TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Regular', 'Mayorista', 'Coleccionista'))
);
CREATE TABLE IF NOT EXISTS vendedor (
  cedula TEXT PRIMARY KEY, nombre TEXT NOT NULL, apellidos TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE, telefono TEXT NOT NULL, puesto TEXT NOT NULL,
  salario_x_hora REAL NOT NULL CHECK(salario_x_hora >= 0)
);
CREATE TABLE IF NOT EXISTS sucursal (
  identificador TEXT PRIMARY KEY, nombre TEXT NOT NULL, ubicacion TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS merch (
  identificador TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE,
  precio_x_unidad REAL NOT NULL CHECK(precio_x_unidad >= 0)
);
CREATE TABLE IF NOT EXISTS color (
  identificador TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS accesorio (
  identificador TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE,
  precio_extra REAL NOT NULL CHECK(precio_extra >= 0)
);
CREATE TABLE IF NOT EXISTS pedido (
  identificador TEXT PRIMARY KEY, fecha TEXT NOT NULL,
  metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('Efectivo', 'Tarjeta', 'SINPE')),
  cliente TEXT NOT NULL, atendido_por TEXT NOT NULL, sucursal TEXT NOT NULL,
  merch TEXT NOT NULL, cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  color TEXT NOT NULL, accesorio TEXT NOT NULL,
  monto_total REAL NOT NULL DEFAULT 0 CHECK(monto_total >= 0),
  FOREIGN KEY (cliente) REFERENCES cliente(cedula) ON DELETE RESTRICT,
  FOREIGN KEY (atendido_por) REFERENCES vendedor(cedula) ON DELETE RESTRICT,
  FOREIGN KEY (sucursal) REFERENCES sucursal(identificador) ON DELETE RESTRICT,
  FOREIGN KEY (merch) REFERENCES merch(identificador) ON DELETE RESTRICT,
  FOREIGN KEY (color) REFERENCES color(identificador) ON DELETE RESTRICT,
  FOREIGN KEY (accesorio) REFERENCES accesorio(identificador) ON DELETE RESTRICT
);
"""

# Datos iniciales: solo se insertan una vez, cuando la base está vacía.
SEED = {
    "vendedor": [
        ("1-1111-1111", "Lucía", "Mora Solano", "lucia.mora@capy.cr", "8888-1111", "Encargada de tienda", 3200.0),
        ("2-2222-2222", "Diego", "Vargas Rojas", "diego.vargas@capy.cr", "8888-2222", "Vendedor", 2600.0),
    ],
    "cliente": [
        ("3-3333-3333", "Andrea", "Jiménez Castro", "andrea.jimenez@correo.com", "8777-3333", "Regular"),
        ("4-4444-4444", "Mateo", "Salas Brenes", "mateo.salas@correo.com", "8666-4444", "Mayorista"),
        ("5-5555-5555", "Valeria", "Chaves Araya", "valeria.chaves@correo.com", "8555-5555", "Coleccionista"),
    ],
    "sucursal": [
        ("SUC-01", "Capy Centro", "San José, Avenida Central"),
        ("SUC-02", "Capy Heredia", "Heredia, frente al parque"),
    ],
    "merch": [
        ("MER-01", "Camiseta", 7500), ("MER-02", "Sudadero", 17500), ("MER-03", "Gorra", 6000),
        ("MER-04", "Taza", 5600), ("MER-05", "Peluche", 12500), ("MER-06", "Cojín", 9990),
        ("MER-07", "Tote bag", 6600), ("MER-08", "Libreta", 4900),
    ],
    "color": [
        ("COL-01", "Café capibara"), ("COL-02", "Naranja"), ("COL-03", "Verde hoja"),
        ("COL-04", "Crema"), ("COL-05", "Negro"),
    ],
    "accesorio": [
        ("ACC-00", "Sin accesorio", 0), ("ACC-01", "Llavero", 3400), ("ACC-02", "Pack de stickers", 2750),
        ("ACC-03", "Pin metálico", 2200), ("ACC-04", "Bolsa de regalo", 1500),
    ],
}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# Se mantiene el nombre usado en el proyecto del taller.
get_connection = _connect


@contextmanager
def db():
    """Abre una conexión, confirma los cambios si todo sale bien y siempre la cierra."""
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _respaldar_base_antigua():
    """Si la base viene de una versión anterior del esquema, se guarda como copia y se crea una nueva."""
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        tablas = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]
    finally:
        conn.close()
    if tablas and version != SCHEMA_VERSION:
        DB_PATH.replace(DB_PATH.with_name(DB_PATH.stem + "_anterior.db"))


def initialize_database():
    if os.environ.get("VERCEL") and not DB_PATH.exists() and SOURCE_DB.exists():
        shutil.copy(SOURCE_DB, DB_PATH)
    _respaldar_base_antigua()
    with db() as conn:
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        if conn.execute("SELECT COUNT(*) FROM cliente").fetchone()[0] == 0:
            for table, rows in SEED.items():
                marks = ", ".join("?" for _ in rows[0])
                conn.executemany(f"INSERT INTO {table} VALUES ({marks})", rows)


if __name__ == "__main__":
    initialize_database()
    print(f"Base de datos lista en {DB_PATH}")

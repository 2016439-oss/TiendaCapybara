"""API REST de la Tienda Capybara, basada en la guía Python + SQLite + FastAPI."""
from contextlib import asynccontextmanager
import sqlite3
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from database import db, initialize_database

PUBLIC_DIR = Path(__file__).resolve().parent / "public"

# Los identificadores solo admiten letras, números, guion y guion bajo (así viajan seguros en la URL).
Id = Annotated[str, Field(min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_\-]+$")]
Texto = Annotated[str, Field(min_length=1, max_length=120)]
Correo = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)]
MetodoPago = Literal["Efectivo", "Tarjeta", "SINPE"]


# ---------------------------------------------------------------- Modelos
class Cliente(BaseModel):
    cedula: Id
    nombre: Texto
    apellidos: Texto
    correo: Correo
    telefono: str = Field(min_length=1, max_length=30)
    tipo: Literal["Regular", "Mayorista", "Coleccionista"]


class Vendedor(BaseModel):
    cedula: Id
    nombre: Texto
    apellidos: Texto
    correo: Correo
    telefono: str = Field(min_length=1, max_length=30)
    puesto: Texto
    salario_x_hora: float = Field(ge=0)


class Sucursal(BaseModel):
    identificador: Id
    nombre: Texto
    ubicacion: Texto


class Merch(BaseModel):
    identificador: Id
    nombre: Texto
    precio_x_unidad: float = Field(ge=0)


class Color(BaseModel):
    identificador: Id
    nombre: Texto


class Accesorio(BaseModel):
    identificador: Id
    nombre: Texto
    precio_extra: float = Field(ge=0)


class Pedido(BaseModel):
    identificador: Id
    fecha: date
    metodo_pago: MetodoPago
    cliente: Id
    atendido_por: Id
    sucursal: Id  # lugar donde se retira el pedido
    merch: Id
    cantidad: int = Field(gt=0, le=999)
    color: Id
    accesorio: Id
    monto_total: float = Field(default=0, ge=0)  # lo calcula el servidor


class Compra(BaseModel):
    """Datos que llegan desde la pantalla de compra; el identificador y la fecha los pone el servidor."""
    cliente: Id
    atendido_por: Id
    sucursal: Id
    metodo_pago: MetodoPago
    merch: Id
    cantidad: int = Field(gt=0, le=999)
    color: Id
    accesorio: Id


MODELS = {
    "cliente": Cliente, "vendedor": Vendedor, "sucursal": Sucursal, "merch": Merch,
    "color": Color, "accesorio": Accesorio, "pedido": Pedido,
}
PRIMARY_KEYS = {
    "cliente": "cedula", "vendedor": "cedula", "sucursal": "identificador", "merch": "identificador",
    "color": "identificador", "accesorio": "identificador", "pedido": "identificador",
}
TABLES = set(MODELS)


# ---------------------------------------------------------------- Utilidades
def check_table(table: str):
    if table not in TABLES:
        raise HTTPException(404, "Entidad no encontrada")


def fetch(conn, table: str, key: str):
    row = conn.execute(f"SELECT * FROM {table} WHERE {PRIMARY_KEYS[table]} = ?", (key,)).fetchone()
    if not row:
        raise HTTPException(404, "Registro no encontrado")
    return dict(row)


def db_error(exc: sqlite3.IntegrityError):
    raise HTTPException(409, "No se puede completar la operación: clave duplicada o relación inexistente/en uso.") from exc


def calcular_total(conn, merch: str, accesorio: str, cantidad: int) -> float:
    """Total = (precio del merch + precio extra del accesorio) x cantidad."""
    m = conn.execute("SELECT precio_x_unidad FROM merch WHERE identificador = ?", (merch,)).fetchone()
    a = conn.execute("SELECT precio_extra FROM accesorio WHERE identificador = ?", (accesorio,)).fetchone()
    if not m:
        raise HTTPException(409, "El tipo de merch indicado no existe")
    if not a:
        raise HTTPException(409, "El accesorio indicado no existe")
    return round((m["precio_x_unidad"] + a["precio_extra"]) * cantidad, 2)


def detalle_pedido(conn, identificador: str) -> dict:
    fila = conn.execute(
        "SELECT p.*, c.nombre || ' ' || c.apellidos AS cliente_nombre, v.nombre || ' ' || v.apellidos AS vendedor_nombre, "
        "s.nombre AS sucursal_nombre, s.ubicacion AS sucursal_ubicacion, m.nombre AS merch_nombre, "
        "m.precio_x_unidad AS merch_precio, co.nombre AS color_nombre, a.nombre AS accesorio_nombre, "
        "a.precio_extra AS accesorio_precio FROM pedido p "
        "JOIN cliente c ON c.cedula = p.cliente JOIN vendedor v ON v.cedula = p.atendido_por "
        "JOIN sucursal s ON s.identificador = p.sucursal JOIN merch m ON m.identificador = p.merch "
        "JOIN color co ON co.identificador = p.color JOIN accesorio a ON a.identificador = p.accesorio "
        "WHERE p.identificador = ?", (identificador,)).fetchone()
    if not fila:
        raise HTTPException(404, "Pedido no encontrado")
    return dict(fila)


def siguiente_identificador(conn) -> str:
    numeros = [int(r[0][4:]) for r in conn.execute("SELECT identificador FROM pedido WHERE identificador GLOB 'PED-[0-9]*'")
               if r[0][4:].isdigit()]
    return f"PED-{max(numeros, default=0) + 1:04d}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Tienda Capybara", version="1.0.0", lifespan=lifespan)


@app.exception_handler(ValidationError)
async def validation_error(request: Request, exc: ValidationError):
    """Los datos inválidos de las rutas genéricas responden 422 con el detalle de cada campo."""
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(
        exc.errors(include_url=False, include_context=False, include_input=False))})


# ---------------------------------------------------------------- Rutas especiales (antes de las genéricas)
@app.get("/api/pedido/{identificador}/detalle")
def order_detail(identificador: str):
    with db() as conn:
        return detalle_pedido(conn, identificador)


@app.post("/api/compra", status_code=201)
def registrar_compra(compra: Compra):
    """Registra el pedido: genera el identificador, toma la fecha de hoy y calcula el total."""
    try:
        with db() as conn:
            identificador = siguiente_identificador(conn)
            total = calcular_total(conn, compra.merch, compra.accesorio, compra.cantidad)
            conn.execute(
                "INSERT INTO pedido (identificador, fecha, metodo_pago, cliente, atendido_por, sucursal, merch, cantidad, "
                "color, accesorio, monto_total) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (identificador, date.today().isoformat(), compra.metodo_pago, compra.cliente, compra.atendido_por,
                 compra.sucursal, compra.merch, compra.cantidad, compra.color, compra.accesorio, total))
            return detalle_pedido(conn, identificador)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "Cliente, vendedor, lugar de retiro, merch, color o accesorio inexistente.") from exc


@app.get("/api/resumen")
def resumen():
    with db() as conn:
        return dict(conn.execute(
            "SELECT (SELECT COUNT(*) FROM pedido) AS pedidos, "
            "(SELECT COALESCE(SUM(monto_total), 0) FROM pedido) AS total_facturado, "
            "(SELECT COALESCE(SUM(cantidad), 0) FROM pedido) AS unidades, "
            "(SELECT COUNT(*) FROM cliente) AS clientes").fetchone())


# ---------------------------------------------------------------- CRUD genérico
@app.get("/api/{table}")
def list_rows(table: str):
    check_table(table)
    with db() as conn:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]


@app.get("/api/{table}/{key}")
def get_row(table: str, key: str):
    check_table(table)
    with db() as conn:
        return fetch(conn, table, key)


@app.post("/api/{table}", status_code=201)
def create_row(table: str, payload: dict):
    check_table(table)
    data = MODELS[table].model_validate(payload).model_dump(mode="json")
    try:
        with db() as conn:
            if table == "pedido":
                data["monto_total"] = calcular_total(conn, data["merch"], data["accesorio"], data["cantidad"])
            columns = list(data)
            conn.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                         list(data.values()))
            return fetch(conn, table, data[PRIMARY_KEYS[table]])
    except sqlite3.IntegrityError as exc:
        db_error(exc)


@app.put("/api/{table}/{key}")
def update_row(table: str, key: str, payload: dict):
    check_table(table)
    data = MODELS[table].model_validate(payload).model_dump(mode="json")
    pk = PRIMARY_KEYS[table]
    if data[pk] != key:
        raise HTTPException(400, "La clave de la URL debe coincidir con el cuerpo")
    try:
        with db() as conn:
            actual = fetch(conn, table, key)
            if table == "pedido":
                # El total solo se recalcula si cambió lo que lo determina; así editar el lugar de retiro no lo altera.
                if (data["merch"], data["accesorio"], data["cantidad"]) != (actual["merch"], actual["accesorio"], actual["cantidad"]):
                    data["monto_total"] = calcular_total(conn, data["merch"], data["accesorio"], data["cantidad"])
                else:
                    data["monto_total"] = actual["monto_total"]
            cambios = [c for c in data if c != pk]
            conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in cambios)} WHERE {pk} = ?",
                         [data[c] for c in cambios] + [key])
            return fetch(conn, table, key)
    except sqlite3.IntegrityError as exc:
        db_error(exc)


@app.delete("/api/{table}/{key}", status_code=204)
def delete_row(table: str, key: str):
    check_table(table)
    try:
        with db() as conn:
            fetch(conn, table, key)
            conn.execute(f"DELETE FROM {table} WHERE {PRIMARY_KEYS[table]} = ?", (key,))
    except sqlite3.IntegrityError as exc:
        db_error(exc)


# ---------------------------------------------------------------- Frontend
# En local FastAPI sirve la interfaz; en Vercel la sirve su CDN desde public/.
if PUBLIC_DIR.is_dir():
    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(PUBLIC_DIR / "index.html")

    app.mount("/", StaticFiles(directory=PUBLIC_DIR), name="public")

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


# ---------------------------------------------------------------- Modelos
class Cliente(BaseModel):
    cedula: Id
    nombre: Texto
    apellidos: Texto
    correo: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    telefono: str = Field(min_length=1, max_length=30)
    tipo: Literal["Regular", "Mayorista", "Coleccionista"]


class Vendedor(BaseModel):
    cedula: Id
    nombre: Texto
    apellidos: Texto
    correo: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    telefono: str = Field(min_length=1, max_length=30)
    puesto: Texto
    salario_x_hora: float = Field(ge=0)


class Categoria(BaseModel):
    identificador: Id
    nombre: Texto


class Producto(BaseModel):
    identificador: Id
    marca: Texto
    nombre: Texto
    categoria: Id
    precio_x_unidad: float = Field(ge=0)
    stock: int = Field(ge=0)
    emoji: str = Field(default="🦫", min_length=1, max_length=8)


class Sucursal(BaseModel):
    identificador: Id
    nombre: Texto
    ubicacion: Texto


class Factura(BaseModel):
    identificador: Id
    fecha: date
    monto_total: float = Field(default=0, ge=0)  # se recalcula solo con los artículos de la factura
    metodo_pago: Literal["Efectivo", "Tarjeta", "SINPE"]
    cliente: Id
    atendido_por: Id
    sucursal: Id


class FacturaProducto(BaseModel):
    identificador_factura: Id
    identificador_producto: Id
    cantidad: int = Field(gt=0, le=999)
    precio_unitario: float | None = Field(default=None, ge=0)  # lo toma el servidor del producto


MODELS = {
    "cliente": Cliente, "vendedor": Vendedor, "categoria": Categoria, "producto": Producto,
    "sucursal": Sucursal, "factura": Factura, "factura_producto": FacturaProducto,
}
# Llaves primarias (las tablas intermedias tienen llave compuesta).
PRIMARY_KEYS = {
    "cliente": ("cedula",), "vendedor": ("cedula",), "categoria": ("identificador",),
    "producto": ("identificador",), "sucursal": ("identificador",), "factura": ("identificador",),
    "factura_producto": ("identificador_factura", "identificador_producto"),
}
TABLES = set(MODELS)


# ---------------------------------------------------------------- Utilidades
def check_table(table: str):
    if table not in TABLES:
        raise HTTPException(404, "Entidad no encontrada")


def split_key(table: str, key: str) -> list[str]:
    """La llave de las tablas intermedias llega como 'factura/producto' (dos partes en la URL)."""
    parts = key.split("/")
    if len(parts) != len(PRIMARY_KEYS[table]):
        raise HTTPException(404, "Registro no encontrado")
    return parts


def where(table: str) -> str:
    return " AND ".join(f"{c} = ?" for c in PRIMARY_KEYS[table])


def fetch(conn, table: str, parts: list[str]):
    row = conn.execute(f"SELECT * FROM {table} WHERE {where(table)}", parts).fetchone()
    if not row:
        raise HTTPException(404, "Registro no encontrado")
    return dict(row)


def db_error(exc: sqlite3.IntegrityError):
    raise HTTPException(409, "No se puede completar la operación: clave duplicada o relación inexistente/en uso.") from exc


def recalcular_factura(conn, factura: str):
    """Total de la compra = suma de cantidad x precio unitario de sus artículos."""
    total = conn.execute(
        "SELECT COALESCE(SUM(cantidad * precio_unitario), 0) FROM factura_producto WHERE identificador_factura = ?",
        (factura,)).fetchone()[0]
    conn.execute("UPDATE factura SET monto_total = ? WHERE identificador = ?", (round(total, 2), factura))


def mover_stock(conn, producto: str, cambio: int):
    """Suma (cambio > 0) o descuenta (cambio < 0) unidades del inventario, sin permitir stock negativo."""
    fila = conn.execute("SELECT nombre, stock FROM producto WHERE identificador = ?", (producto,)).fetchone()
    if not fila:
        raise HTTPException(404, "Producto no encontrado")
    if fila["stock"] + cambio < 0:
        raise HTTPException(409, f"Stock insuficiente de «{fila['nombre']}» (quedan {fila['stock']})")
    conn.execute("UPDATE producto SET stock = stock + ? WHERE identificador = ?", (cambio, producto))


def detalle_factura(conn, identificador: str) -> dict:
    factura = conn.execute(
        "SELECT f.*, c.nombre || ' ' || c.apellidos AS cliente_nombre, v.nombre || ' ' || v.apellidos AS vendedor_nombre, "
        "s.nombre AS sucursal_nombre FROM factura f "
        "JOIN cliente c ON c.cedula = f.cliente JOIN vendedor v ON v.cedula = f.atendido_por "
        "JOIN sucursal s ON s.identificador = f.sucursal WHERE f.identificador = ?", (identificador,)).fetchone()
    if not factura:
        raise HTTPException(404, "Factura no encontrada")
    productos = [dict(r) for r in conn.execute(
        "SELECT pr.identificador, pr.nombre, pr.emoji, fp.cantidad, fp.precio_unitario, "
        "fp.cantidad * fp.precio_unitario AS subtotal FROM producto pr JOIN factura_producto fp "
        "ON pr.identificador = fp.identificador_producto WHERE fp.identificador_factura = ?", (identificador,))]
    return {"factura": dict(factura), "productos": productos}


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Tienda Capybara", version="1.0.0", lifespan=lifespan)


@app.exception_handler(ValidationError)
async def validation_error(request: Request, exc: ValidationError):
    """Los datos inválidos de las rutas genéricas responden 422 con el detalle de cada campo."""
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors(include_url=False, include_context=False, include_input=False))})


# ---------------------------------------------------------------- Rutas especiales (antes de las genéricas)
@app.get("/api/factura/{identificador}/detalle")
def invoice_detail(identificador: str):
    with db() as conn:
        return detalle_factura(conn, identificador)


class ItemVenta(BaseModel):
    identificador_producto: Id
    cantidad: int = Field(gt=0, le=999)


class Compra(BaseModel):
    cliente: Id
    atendido_por: Id
    sucursal: Id
    metodo_pago: Literal["Efectivo", "Tarjeta", "SINPE"]
    items: list[ItemVenta] = Field(min_length=1)


@app.post("/api/compra", status_code=201)
def registrar_compra(venta: Compra):
    """Registra una compra completa en una sola transacción: factura, artículos, stock y total."""
    try:
        with db() as conn:
            numeros = [int(r[0][4:]) for r in conn.execute(
                "SELECT identificador FROM factura WHERE identificador GLOB 'FAC-[0-9]*'") if r[0][4:].isdigit()]
            identificador = f"FAC-{max(numeros, default=0) + 1:04d}"
            conn.execute("INSERT INTO factura (identificador, fecha, monto_total, metodo_pago, cliente, atendido_por, sucursal) "
                         "VALUES (?, ?, 0, ?, ?, ?, ?)",
                         (identificador, date.today().isoformat(), venta.metodo_pago, venta.cliente, venta.atendido_por, venta.sucursal))
            cantidades: dict[str, int] = {}
            for item in venta.items:
                cantidades[item.identificador_producto] = cantidades.get(item.identificador_producto, 0) + item.cantidad
            for producto, cantidad in cantidades.items():
                fila = conn.execute("SELECT precio_x_unidad FROM producto WHERE identificador = ?", (producto,)).fetchone()
                if not fila:
                    raise HTTPException(404, f"El producto {producto} no existe")
                mover_stock(conn, producto, -cantidad)
                conn.execute("INSERT INTO factura_producto VALUES (?, ?, ?, ?)",
                             (identificador, producto, cantidad, fila["precio_x_unidad"]))
            recalcular_factura(conn, identificador)
            return detalle_factura(conn, identificador)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "Cliente, vendedor o sucursal inexistente.") from exc


@app.get("/api/resumen")
def resumen():
    with db() as conn:
        datos = dict(conn.execute(
            "SELECT (SELECT COUNT(*) FROM factura) AS facturas, "
            "(SELECT COALESCE(SUM(monto_total), 0) FROM factura) AS ventas, "
            "(SELECT COUNT(*) FROM producto) AS productos, "
            "(SELECT COALESCE(SUM(stock), 0) FROM producto) AS unidades, "
            "(SELECT COUNT(*) FROM cliente) AS clientes").fetchone())
        datos["stock_bajo"] = [dict(r) for r in conn.execute(
            "SELECT identificador, nombre, stock FROM producto WHERE stock <= 10 ORDER BY stock")]
    return datos


# ---------------------------------------------------------------- CRUD genérico
@app.get("/api/{table}")
def list_rows(table: str):
    check_table(table)
    with db() as conn:
        return [dict(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]


@app.get("/api/{table}/{key:path}")
def get_row(table: str, key: str):
    check_table(table)
    with db() as conn:
        return fetch(conn, table, split_key(table, key))


@app.post("/api/{table}", status_code=201)
def create_row(table: str, payload: dict):
    check_table(table)
    data = MODELS[table].model_validate(payload).model_dump(mode="json")
    try:
        with db() as conn:
            if table == "factura":
                data["monto_total"] = 0
            if table == "factura_producto":
                producto = conn.execute("SELECT precio_x_unidad FROM producto WHERE identificador = ?",
                                        (data["identificador_producto"],)).fetchone()
                if not producto:
                    raise HTTPException(404, "Producto no encontrado")
                data["precio_unitario"] = producto["precio_x_unidad"]
                mover_stock(conn, data["identificador_producto"], -data["cantidad"])
            columns = list(data)
            conn.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                         list(data.values()))
            if table == "factura_producto":
                recalcular_factura(conn, data["identificador_factura"])
            return fetch(conn, table, [data[c] for c in PRIMARY_KEYS[table]])
    except sqlite3.IntegrityError as exc:
        db_error(exc)


@app.put("/api/{table}/{key:path}")
def update_row(table: str, key: str, payload: dict):
    check_table(table)
    parts = split_key(table, key)
    data = MODELS[table].model_validate(payload).model_dump(mode="json")
    pk = PRIMARY_KEYS[table]
    if [data[c] for c in pk] != parts:
        raise HTTPException(400, "La clave de la URL debe coincidir con el cuerpo")
    try:
        with db() as conn:
            actual = fetch(conn, table, parts)
            if table == "factura":
                data["monto_total"] = actual["monto_total"]
            if table == "factura_producto":
                data["precio_unitario"] = actual["precio_unitario"]  # el precio de la venta no cambia
                mover_stock(conn, data["identificador_producto"], actual["cantidad"] - data["cantidad"])
            cambios = [c for c in data if c not in pk]
            if cambios:
                conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in cambios)} WHERE {where(table)}",
                             [data[c] for c in cambios] + parts)
            if table == "factura_producto":
                recalcular_factura(conn, data["identificador_factura"])
            return fetch(conn, table, parts)
    except sqlite3.IntegrityError as exc:
        db_error(exc)


@app.delete("/api/{table}/{key:path}", status_code=204)
def delete_row(table: str, key: str):
    check_table(table)
    parts = split_key(table, key)
    try:
        with db() as conn:
            actual = fetch(conn, table, parts)
            if table == "factura":  # al borrar una factura, sus artículos regresan al inventario
                for linea in conn.execute("SELECT * FROM factura_producto WHERE identificador_factura = ?", parts).fetchall():
                    mover_stock(conn, linea["identificador_producto"], linea["cantidad"])
            if table == "factura_producto":
                mover_stock(conn, actual["identificador_producto"], actual["cantidad"])
            conn.execute(f"DELETE FROM {table} WHERE {where(table)}", parts)
            if table == "factura_producto":
                recalcular_factura(conn, actual["identificador_factura"])
    except sqlite3.IntegrityError as exc:
        db_error(exc)


# ---------------------------------------------------------------- Frontend
# En local FastAPI sirve la interfaz; en Vercel la sirve su CDN desde public/.
if PUBLIC_DIR.is_dir():
    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(PUBLIC_DIR / "index.html")

    app.mount("/", StaticFiles(directory=PUBLIC_DIR), name="public")

from urllib.parse import quote_plus

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import get_settings

settings = get_settings()

odbc_connect = (
    "DRIVER={{{driver}}};"
    "SERVER={host},{port};"
    "DATABASE={db};"
    "UID={user};"
    "PWD={password};"
    "TrustServerCertificate={trust};"
).format(
    driver=settings.db_driver,
    host=settings.db_host,
    port=settings.db_port,
    db=settings.db_name,
    user=settings.db_user,
    password=settings.db_password,
    trust="yes" if settings.db_trust_server_certificate else "no",
)

SQLALCHEMY_DATABASE_URL = f"mssql+pyodbc:///?odbc_connect={quote_plus(odbc_connect)}"

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

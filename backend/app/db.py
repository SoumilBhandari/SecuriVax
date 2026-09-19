from collections.abc import Iterator

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings


def normalize_url(url: str) -> str:
    """Hosts hand out postgres:// URLs; SQLAlchemy wants the psycopg driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str):
    url = normalize_url(url)
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)
    return create_engine(url, pool_pre_ping=True)


engine = make_engine(get_settings().database_url)


def drop_demo_tables(eng) -> None:
    """Drop every table except the ones a demo reset keeps (accounts)."""
    from app.models import KEEP_ON_RESET

    SQLModel.metadata.drop_all(eng, tables=[t for t in SQLModel.metadata.sorted_tables if t.name not in KEEP_ON_RESET])


def init_db(eng=None) -> None:
    import app.models  # noqa: F401  (registers the tables)

    eng = eng or engine
    SQLModel.metadata.create_all(eng)
    add_missing_columns(eng)


def add_missing_columns(eng) -> None:
    """create_all makes missing tables but never alters existing ones. New
    nullable columns (or ones with a default) are added in place, so a deploy
    with a newer model keeps its data instead of failing on the first query."""
    from sqlalchemy import inspect, text

    inspector = inspect(eng)
    with eng.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            have = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in have:
                    continue
                default = column.default.arg if column.default is not None and not callable(column.default.arg) else None
                if not column.nullable and default is None:
                    continue  # can't add a required column to rows that exist
                ddl = column.type.compile(dialect=eng.dialect)
                clause = ""
                if default is not None:
                    literal = ("TRUE" if default else "FALSE") if isinstance(default, bool) else repr(default)
                    clause = f" DEFAULT {literal}"
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl}{clause}'))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session

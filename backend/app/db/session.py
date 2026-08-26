import os
from pathlib import Path
from typing import AsyncGenerator
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.exc import OperationalError, ProgrammingError
from app.db.base import Base

logger = logging.getLogger(__name__)

# Resolve absolute SQLite path for app.db
backend_dir = Path(__file__).resolve().parent.parent
db_path = backend_dir / "app.db"
DB_URL = f"sqlite+aiosqlite:///{db_path}"

engine = create_async_engine(
    DB_URL,
    echo=False,
    pool_pre_ping=True,
)

async_session_maker = async_sessionmaker(
    engine,
    expire_on_commit=False,
)


async def create_db_and_tables() -> None:
    """Ensure all SQLAlchemy tables are registered and created in SQLite."""
    # Import ingestion models to register them on Base.metadata
    from app.modules.fabric.models.ingestion_models import TableSyncJob, SyncJobRun  # noqa: F401
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except (OperationalError, ProgrammingError) as e:
        logger.warning(f"Ignored error during table creation: {e}")
    except Exception as e:
        logger.error(f"Unexpected error during table creation: {e}")


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency yielding an async DB session for route handlers."""
    async with async_session_maker() as session:
        yield session

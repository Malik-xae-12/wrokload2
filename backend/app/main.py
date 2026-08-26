from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from app.db.session import create_db_and_tables
from app.modules.fabric.router_ingestion import router as ingestion_router


def simple_generate_unique_route_id(route: APIRoute) -> str:
    tag = route.tags[0] if route.tags else "api"
    return f"{tag}-{route.name}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_db_and_tables()
    yield


app = FastAPI(
    title="Azure SQL to Microsoft Fabric Data Ingestion Service",
    generate_unique_id_function=simple_generate_unique_route_id,
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# CORS middleware to allow all requests from frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ingestion Router
app.include_router(ingestion_router)


@app.get("/")
async def root():
    return {
        "service": "Azure SQL to Microsoft Fabric Ingestion API",
        "status": "running",
        "version": "1.0.0",
    }

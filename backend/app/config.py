import os
from pathlib import Path
from pydantic_settings import BaseSettings

DATA_DIR = Path(os.environ.get("TODOAI_DATA_DIR", Path.home() / ".todoai"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

class Settings(BaseSettings):
    database_url: str = f"sqlite:///{DATA_DIR / 'todoai.db'}"
    google_credentials_path: str = str(DATA_DIR / "google_credentials.json")
    google_token_path: str = str(DATA_DIR / "google_token.json")
    host: str = "127.0.0.1"
    port: int = 18427
    bulk_create_limit: int = 50

settings = Settings()

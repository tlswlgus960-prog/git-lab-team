"""pm2 진입점: `python -m model_api.main` → 127.0.0.1:9541"""
import os

import uvicorn


def main() -> None:
    uvicorn.run("model_api.app:app", host=os.environ.get("MODEL_API_HOST", "127.0.0.1"), port=int(os.environ.get("MODEL_API_PORT", "9541")),
                workers=1, log_level="warning")


if __name__ == "__main__":
    main()

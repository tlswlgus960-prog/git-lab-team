"""pm2 진입점: `python -m llm_server.main` → 127.0.0.1:8200 (내부 전용, BR-SRV-04)"""
import os

import uvicorn


def main() -> None:
    uvicorn.run("llm_server.app:app", host="127.0.0.1", port=int(os.environ.get("LLM_SERVER_PORT", "8200")),
                workers=1, log_level="warning")


if __name__ == "__main__":
    main()

"""pm2 진입점: `python -m workers.main --group cpu_vision|gpu`"""
from __future__ import annotations

import argparse
import signal

from .runner import Worker


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", choices=["cpu_vision", "gpu"], required=True)
    args = ap.parse_args()
    w = Worker(args.group)
    signal.signal(signal.SIGTERM, lambda *_: w.stop())
    signal.signal(signal.SIGINT, lambda *_: w.stop())
    w.run_forever()


if __name__ == "__main__":
    main()

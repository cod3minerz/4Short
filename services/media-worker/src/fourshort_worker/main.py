import logging

from .config import Settings
from .worker import Worker


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    Worker(Settings()).run_forever()


if __name__ == "__main__":
    main()

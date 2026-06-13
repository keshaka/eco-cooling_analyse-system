"""
Entry point to run the Eco-Cooling Telegram bot as a standalone process.

Usage:
    python run_telegram_bot.py

Requires a valid .env file in the backend/ directory with TELEGRAM_BOT_TOKEN set.
"""

import logging
import sys
from pathlib import Path

# Ensure the backend directory is on the Python path so `app.*` imports work.
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

# Load .env before importing app modules that read settings at import time.
load_dotenv(backend_dir / ".env")

from app.core.logging_config import configure_logging
from app.telegram_bot import create_bot_app

configure_logging("INFO")
logger = logging.getLogger(__name__)


def main():
    logger.info("Starting Urban Heat Telegram Bot...")
    bot_app = create_bot_app()
    bot_app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()

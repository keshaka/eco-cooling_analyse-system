"""
Telegram bot for the Eco-Cooling Monitoring System.

Features:
  /start   — Welcome message + display user's chat ID
  /latest  — Fetch and display latest moss & non-moss sensor readings
  /backup  — Trigger an MSSQL database backup and report the result

Background job:
  - Checks every 60 seconds if both moss and non-moss data are stale
    (no new row within the configured timeout window).
  - Sends an alert to the configured chat IDs once per outage event.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyodbc
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from app.core.config import get_settings

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_alert_sent = False  # Tracks whether a no-data alert has already fired


def _get_db_connection():
    """Create a raw pyodbc connection using the app settings."""
    settings = get_settings()
    conn_str = (
        f"DRIVER={{{settings.db_driver}}};"
        f"SERVER={settings.db_host},{settings.db_port};"
        f"DATABASE={settings.db_name};"
        f"UID={settings.db_user};"
        f"PWD={settings.db_password};"
        f"TrustServerCertificate={'yes' if settings.db_trust_server_certificate else 'no'};"
    )
    return pyodbc.connect(conn_str)


def _format_timestamp(ts: datetime | None) -> str:
    """Format a naive (UTC-assumed) or aware timestamp to IST string."""
    if ts is None:
        return "N/A"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    ist_ts = ts.astimezone(IST)
    return ist_ts.strftime("%Y-%m-%d %H:%M:%S IST")


def _fmt(value, suffix: str = "°C", decimals: int = 2) -> str:
    """Safely format a numeric value that might be None."""
    if value is None:
        return "N/A"
    return f"{value:.{decimals}f}{suffix}"


def _get_alert_chat_ids() -> list[int]:
    """Return the list of chat IDs that should receive no-data alerts."""
    settings = get_settings()
    raw = settings.telegram_alert_chat_ids
    if not raw.strip():
        return []
    return [int(cid.strip()) for cid in raw.split(",") if cid.strip()]


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start — greet the user and show their chat ID."""
    chat_id = update.effective_chat.id
    await update.message.reply_text(
        f"🌿 *Urban Heat Bot*\n\n"
        f"Your Chat ID: `{chat_id}`\n\n"
        f"*Available commands:*\n"
        f"/latest — View latest sensor readings\n"
        f"/backup — Trigger a database backup\n",
        parse_mode="Markdown",
    )


async def latest_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /latest — fetch and display the most recent sensor data."""
    await update.message.reply_text("⏳ Fetching latest data...")

    try:
        conn = _get_db_connection()
        cursor = conn.cursor()

        # Latest moss data
        cursor.execute(
            "SELECT TOP 1 outdoor_temp, outdoor_humidity, moss_surface_temp, "
            "near_moss_temp, near_moss_humidity, wall_temp, [timestamp] "
            "FROM moss_data ORDER BY [timestamp] DESC"
        )
        moss_row = cursor.fetchone()

        # Latest non-moss data
        cursor.execute(
            "SELECT TOP 1 non_moss_surface_temp, near_non_moss_temp, "
            "near_non_moss_humidity, wall_temp, [timestamp] "
            "FROM non_moss_data ORDER BY [timestamp] DESC"
        )
        non_moss_row = cursor.fetchone()

        cursor.close()
        conn.close()

        lines = []

        if moss_row:
            lines.append(f"  🌡 Outdoor Temp: `{_fmt(moss_row[0])}`")
            lines.append(f"  💧 Outdoor Humidity: `{_fmt(moss_row[1], suffix='%')}`")

            lines.append("")
            
            lines.append("🟢 *Moss Side*")
            lines.append(f"  🌿 Moss Surface Temp: `{_fmt(moss_row[2])}`")
            lines.append(f"  🌡 Near-Moss Temp: `{_fmt(moss_row[3])}`")
            lines.append(f"  💧 Near-Moss Humidity: `{_fmt(moss_row[4], suffix='%')}`")
            lines.append(f"  🧱 Wall Temp: `{_fmt(moss_row[5])}`")
            lines.append(f"  🕐 Timestamp: `{_format_timestamp(moss_row[6])}`")
        else:
            lines.append("🟢 *Moss Side*: No data available")

        lines.append("")

        if non_moss_row:
            lines.append("🔴 *Non-Moss Side*")
            lines.append(f"  🏗 Surface Temp: `{_fmt(non_moss_row[0])}`")
            lines.append(f"  🌡 Near Temp: `{_fmt(non_moss_row[1])}`")
            lines.append(f"  💧 Near Humidity: `{_fmt(non_moss_row[2], suffix='%')}`")
            lines.append(f"  🧱 Wall Temp: `{_fmt(non_moss_row[3])}`")
            lines.append(f"  🕐 Timestamp: `{_format_timestamp(non_moss_row[4])}`")
        else:
            lines.append("🔴 *Non-Moss Side*: No data available")

        # Cooling delta
        if moss_row and non_moss_row and non_moss_row[0] is not None and moss_row[2] is not None:
            delta = non_moss_row[0] - moss_row[2]
            lines.append("")
            lines.append(f"❄️ *Cooling Delta (Surface)*: `{delta:.3f}°C`")

        await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

    except Exception as exc:
        logger.exception("Error fetching latest data")
        await update.message.reply_text(f"❌ Error fetching data: {exc}")


async def backup_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /backup — trigger a MSSQL database backup."""
    settings = get_settings()
    backup_dir = Path(settings.db_backup_dir)
    # SQL Server may run in Docker; use a separate path for the SQL command
    sql_backup_dir = settings.db_backup_dir_sql or settings.db_backup_dir

    await update.message.reply_text("⏳ Starting database backup...")

    try:
        # Ensure host backup directory exists
        backup_dir.mkdir(parents=True, exist_ok=True)

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"{settings.db_name}_{timestamp_str}.bak"
        backup_path = backup_dir / backup_filename
        # Path that SQL Server sees (inside the Docker container)
        sql_backup_path = f"{sql_backup_dir}/{backup_filename}"

        conn = _get_db_connection()
        conn.autocommit = True
        cursor = conn.cursor()

        cursor.execute(
            f"BACKUP DATABASE [{settings.db_name}] "
            f"TO DISK = N'{sql_backup_path}' "
            f"WITH FORMAT, INIT, NAME = N'{settings.db_name} Backup'"
        )

        # BACKUP DATABASE may produce multiple result sets
        while cursor.nextset():
            pass

        cursor.close()
        conn.close()

        # Check file size — make file readable first (Docker creates as UID 10001)
        try:
            os.chmod(backup_path, 0o644)
        except OSError:
            pass  # non-fatal; stat/send may still work if ACLs allow

        file_size_mb = backup_path.stat().st_size / (1024 * 1024)

        msg = (
            f"✅ *Backup Completed*\n\n"
            f"📁 File: `{backup_filename}`\n"
            f"📂 Path: `{backup_path}`\n"
            f"📦 Size: `{file_size_mb:.2f} MB`"
        )
        await update.message.reply_text(msg, parse_mode="Markdown")

        # Send the file if small enough (Telegram limit: 50 MB)
        try:
            if file_size_mb < 50:
                with open(backup_path, "rb") as f:
                    await update.message.reply_document(
                        document=f,
                        filename=backup_filename,
                        caption="📎 Database backup file",
                    )
            else:
                await update.message.reply_text(
                    "ℹ️ Backup file is too large to send via Telegram (>50 MB). "
                    "Please collect it from the server."
                )
        except PermissionError:
            await update.message.reply_text(
                "⚠️ Backup saved on server but couldn't send file (permission denied). "
                "Collect it manually from the server."
            )

    except Exception as exc:
        logger.exception("Error during database backup")
        await update.message.reply_text(f"❌ Backup failed: {exc}")


# ---------------------------------------------------------------------------
# Background data-gap monitor
# ---------------------------------------------------------------------------


async def check_data_gap(context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Periodic job that checks whether both APIs have gone silent.

    Runs every 60 seconds. If the latest timestamp in BOTH moss_data and
    non_moss_data is older than the configured timeout, alert the designated
    users — but only once per outage event.
    """
    global _alert_sent
    settings = get_settings()
    timeout_minutes = settings.telegram_data_timeout_minutes

    try:
        conn = _get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT MAX([timestamp]) FROM moss_data")
        moss_latest = cursor.fetchone()[0]

        cursor.execute("SELECT MAX([timestamp]) FROM non_moss_data")
        non_moss_latest = cursor.fetchone()[0]

        cursor.close()
        conn.close()

        now = datetime.now()
        threshold = now - timedelta(minutes=timeout_minutes)

        moss_stale = moss_latest is None or moss_latest < threshold
        non_moss_stale = non_moss_latest is None or non_moss_latest < threshold

        if moss_stale and non_moss_stale:
            if not _alert_sent:
                _alert_sent = True

                moss_age = (
                    f"{(now - moss_latest).total_seconds() / 60:.1f} min ago"
                    if moss_latest
                    else "never"
                )
                non_moss_age = (
                    f"{(now - non_moss_latest).total_seconds() / 60:.1f} min ago"
                    if non_moss_latest
                    else "never"
                )

                alert_msg = (
                    f"🚨 *DATA GAP ALERT*\n\n"
                    f"No new data received in the last *{timeout_minutes} minutes* "
                    f"from either sensor node!\n\n"
                    f"🟢 Moss last data: `{moss_age}`\n"
                    f"🔴 Non-Moss last data: `{non_moss_age}`\n\n"
                    f"⏰ Checked at: `{_format_timestamp(now)}`\n\n"
                    f"Please check the ESP32 devices and network connectivity."
                )

                for chat_id in _get_alert_chat_ids():
                    try:
                        await context.bot.send_message(
                            chat_id=chat_id,
                            text=alert_msg,
                            parse_mode="Markdown",
                        )
                        logger.info("Sent data-gap alert to chat %s", chat_id)
                    except Exception as send_exc:
                        logger.error(
                            "Failed to send alert to chat %s: %s", chat_id, send_exc
                        )
        else:
            # Data is flowing again — reset the flag so next outage triggers an alert
            if _alert_sent:
                logger.info("Data resumed, resetting alert flag")
                # Notify users that data has resumed
                resume_msg = (
                    "✅ *Data Resumed*\n\n"
                    "Sensor data is flowing again. The monitoring alert has been reset."
                )
                for chat_id in _get_alert_chat_ids():
                    try:
                        await context.bot.send_message(
                            chat_id=chat_id,
                            text=resume_msg,
                            parse_mode="Markdown",
                        )
                    except Exception:
                        pass
            _alert_sent = False

    except Exception as exc:
        logger.exception("Error in data-gap monitor: %s", exc)


# ---------------------------------------------------------------------------
# Bot factory
# ---------------------------------------------------------------------------


async def scheduled_backup(context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Daily automated backup job.

    Runs at the configured time, performs a database backup, and sends
    the .bak file to all alert chat IDs.
    """
    settings = get_settings()
    backup_dir = Path(settings.db_backup_dir)
    sql_backup_dir = settings.db_backup_dir_sql or settings.db_backup_dir
    chat_ids = _get_alert_chat_ids()

    if not chat_ids:
        logger.warning("Scheduled backup: no alert chat IDs configured, skipping.")
        return

    logger.info("Starting scheduled daily backup...")

    try:
        backup_dir.mkdir(parents=True, exist_ok=True)

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"{settings.db_name}_{timestamp_str}.bak"
        backup_path = backup_dir / backup_filename
        sql_backup_path = f"{sql_backup_dir}/{backup_filename}"

        conn = _get_db_connection()
        conn.autocommit = True
        cursor = conn.cursor()

        cursor.execute(
            f"BACKUP DATABASE [{settings.db_name}] "
            f"TO DISK = N'{sql_backup_path}' "
            f"WITH FORMAT, INIT, NAME = N'{settings.db_name} Daily Backup'"
        )

        while cursor.nextset():
            pass

        cursor.close()
        conn.close()

        # Make file readable
        try:
            os.chmod(backup_path, 0o644)
        except OSError:
            pass

        file_size_mb = backup_path.stat().st_size / (1024 * 1024)

        msg = (
            f"🔄 *Scheduled Daily Backup*\n\n"
            f"📁 File: `{backup_filename}`\n"
            f"📦 Size: `{file_size_mb:.2f} MB`\n"
            f"⏰ Time: `{_format_timestamp(datetime.now(timezone.utc))}`"
        )

        for chat_id in chat_ids:
            try:
                await context.bot.send_message(
                    chat_id=chat_id, text=msg, parse_mode="Markdown"
                )
                # Send file if under 50 MB
                if file_size_mb < 50:
                    with open(backup_path, "rb") as f:
                        await context.bot.send_document(
                            chat_id=chat_id,
                            document=f,
                            filename=backup_filename,
                            caption="📎 Automated daily backup",
                        )
                else:
                    await context.bot.send_message(
                        chat_id=chat_id,
                        text="ℹ️ Backup file too large to send (>50 MB). Collect from server.",
                    )
            except Exception as send_exc:
                logger.error("Failed to send backup to chat %s: %s", chat_id, send_exc)

        # Clean up old backups (keep last 7 days)
        cutoff = datetime.now().timestamp() - (7 * 86400)
        for old_file in backup_dir.glob("*.bak"):
            if old_file.stat().st_mtime < cutoff:
                old_file.unlink()
                logger.info("Deleted old backup: %s", old_file.name)

        logger.info("Scheduled backup completed: %s", backup_filename)

    except Exception as exc:
        logger.exception("Scheduled backup failed: %s", exc)
        error_msg = f"❌ *Scheduled Backup Failed*\n\n`{exc}`"
        for chat_id in chat_ids:
            try:
                await context.bot.send_message(
                    chat_id=chat_id, text=error_msg, parse_mode="Markdown"
                )
            except Exception:
                pass


def create_bot_app() -> Application:
    """Build and return the Telegram bot Application."""
    settings = get_settings()

    if not settings.telegram_bot_token:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN is not set. "
            "Please configure it in the .env file."
        )

    app = Application.builder().token(settings.telegram_bot_token).build()

    # Register command handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("latest", latest_command))
    app.add_handler(CommandHandler("backup", backup_command))

    # Schedule the data-gap monitor (every 60 seconds)
    app.job_queue.run_repeating(
        check_data_gap,
        interval=60,
        first=10,  # first check 10 seconds after startup
        name="data_gap_monitor",
    )

    # Schedule daily automated backup
    try:
        hour, minute = map(int, settings.db_backup_time.split(":"))
        backup_time = datetime.now(IST).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        ).timetz()
        app.job_queue.run_daily(
            scheduled_backup,
            time=backup_time,
            name="daily_backup",
        )
        logger.info(
            "Daily backup scheduled at %s IST",
            settings.db_backup_time,
        )
    except (ValueError, AttributeError) as exc:
        logger.error("Invalid DB_BACKUP_TIME format: %s", exc)

    logger.info("Telegram bot configured with data-gap monitor (interval=60s)")
    return app


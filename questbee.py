#!/usr/bin/env python3
"""Questbee CLI — install, start, stop, update, and manage your server."""

import getpass
import os
import platform
import re
import secrets
import subprocess
import sys
import time
import socket
from pathlib import Path

# ── Colors ────────────────────────────────────────────────────────────────────

def _cmd():
    return "questbee" if platform.system() == "Windows" else "./questbee"

def _supports_color():
    if platform.system() == "Windows":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleMode(
                ctypes.windll.kernel32.GetStdHandle(-11), 7)
            return True
        except Exception:
            return False
    return sys.stdout.isatty()

_COLOR = _supports_color()

def _c(text, code): return f"\033[{code}m{text}\033[0m" if _COLOR else text
def green(t):  return _c(t, "32")
def yellow(t): return _c(t, "33")
def red(t):    return _c(t, "31")
def cyan(t):   return _c(t, "36")
def bold(t):   return _c(t, "1")
def dim(t):    return _c(t, "2")

def ok(msg):      print(green("✓ ") + msg)
def warn(msg):    print(yellow("⚠ ") + msg)
def err(msg):     print(red("✗ ") + msg)
def info(msg):    print(cyan("→ ") + msg)
def step(n, msg): print(f"\n{bold(str(n) + '.')} {msg}")

# ── Helpers ───────────────────────────────────────────────────────────────────

HERE = Path(__file__).parent.resolve()

def run(cmd, check=True):
    subprocess.run(cmd, shell=True, check=check, cwd=HERE)

def run_ok(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, cwd=HERE)
    return r.returncode == 0

def ask(prompt, default=None):
    suffix = f" [{default}]" if default else ""
    val = input(f"  {prompt}{suffix}: ").strip()
    return val or default or ""

def ask_password(prompt):
    while True:
        pw = getpass.getpass(f"  {prompt}: ")
        if len(pw) < 8:
            warn("  Password must be at least 8 characters.")
            continue
        pw2 = getpass.getpass(f"  Confirm: ")
        if pw != pw2:
            warn("  Passwords do not match, try again.")
            continue
        return pw

def ask_yes(prompt, default=True):
    suffix = "[Y/n]" if default else "[y/N]"
    val = input(f"  {prompt} {suffix} ").strip().lower()
    return (val in ("y", "yes")) if val else default

# ── Docker ────────────────────────────────────────────────────────────────────

def ensure_docker():
    if not run_ok("docker --version"):
        err("Docker is not installed.")
        sys_name = platform.system()
        if sys_name == "Linux":
            if ask_yes("Install Docker now?"):
                info("Running the official Docker install script…")
                run("curl -fsSL https://get.docker.com | sh")
                user = os.environ.get("USER", "")
                if user:
                    run(f"sudo usermod -aG docker {user}", check=False)
                ok("Docker installed.")
                print("  " + dim(f"You may need to log out and back in, then run: {_cmd()} install"))
                sys.exit(0)
        else:
            print(f"  Download Docker Desktop: {cyan('https://www.docker.com/products/docker-desktop/')}")
        sys.exit(1)

    if not run_ok("docker info"):
        err("Docker is installed but not running.")
        if platform.system() == "Linux":
            if ask_yes("Start Docker now?"):
                run("sudo systemctl start docker", check=False)
                time.sleep(2)
                if not run_ok("docker info"):
                    err("Could not start Docker. Try: sudo systemctl start docker")
                    sys.exit(1)
                ok("Docker started.")
                return
        else:
            print("  Please open Docker Desktop and wait for it to start, then try again.")
        sys.exit(1)

    if not run_ok("docker compose version"):
        err("Docker Compose plugin not found. Please update Docker Desktop.")
        sys.exit(1)

    ok("Docker is ready.")

# ── Git ───────────────────────────────────────────────────────────────────────

def ensure_git():
    if run_ok("git --version"):
        ok("Git is ready.")
        return
    err("Git is not installed.")
    if platform.system() == "Linux":
        if ask_yes("Install Git now?"):
            if run_ok("which apt-get"):
                run("sudo apt-get install -y git")
            elif run_ok("which yum"):
                run("sudo yum install -y git")
            else:
                print(f"  Install Git from: {cyan('https://git-scm.com/downloads')}")
                sys.exit(1)
            ok("Git installed.")
            return
    else:
        print(f"  Install Git from: {cyan('https://git-scm.com/downloads')}")
    sys.exit(1)

# ── Network ───────────────────────────────────────────────────────────────────

def get_local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("10.254.254.254", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips)

# ── .env helpers ──────────────────────────────────────────────────────────────

def _set_env_value(lines, key, value):
    """Replace the value of an existing KEY=... line, or append it."""
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            return
    lines.append(f"{key}={value}")

# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_install():
    print(f"\n{bold('Questbee — Installation')}\n")

    env_file = HERE / ".env"
    if env_file.exists():
        ok("Questbee is already installed.")
        print("  Run " + bold(f"{_cmd()} start") + "   to start the server.")
        print("  Run " + bold(f"{_cmd()} status") + "  to check if it's running.")
        return

    step(1, "Checking Docker…")
    ensure_docker()

    step(2, "Configuration")
    env_example = HERE / ".env.example"
    if not env_example.exists():
        err(".env.example not found. Make sure you're in the Questbee folder.")
        sys.exit(1)

    print()
    print(f"  {bold('Admin account')}")
    admin_email = ask("Admin email")
    while not re.match(r"^[^@]+@[^@]+\.[^@]+$", admin_email):
        warn("  That doesn't look like a valid email address.")
        admin_email = ask("Admin email")
    admin_password = ask_password("Admin password (min 8 chars)")

    print()
    print(f"  {bold('Security — auto-generated')}")
    db_password = secrets.token_urlsafe(20)
    secret_key  = secrets.token_hex(32)
    ok(f"DB password:  {dim(db_password)}")
    ok(f"Secret key:   {dim(secret_key[:20] + '…')}")
    print(f"  {dim('Both are saved in .env — keep that file private.')}")

    # Detect local IP for mobile pairing hint
    ips = get_local_ips()
    local_ip = ips[0] if ips else "localhost"

    # Build .env from .env.example, replacing placeholder values line-by-line
    lines = env_example.read_text().splitlines()
    _set_env_value(lines, "DB_PASSWORD",          db_password)
    _set_env_value(lines, "SECRET_KEY",            secret_key)
    _set_env_value(lines, "ADMIN_EMAIL",           admin_email)
    _set_env_value(lines, "ADMIN_PASSWORD",        admin_password)
    _set_env_value(lines, "ALLOWED_ORIGINS",       f"http://localhost:3000,http://{local_ip}:3000")
    _set_env_value(lines, "NEXT_PUBLIC_API_URL",   "http://localhost:8000/api/v1")
    env_file.write_text("\n".join(lines) + "\n")
    ok(".env saved.")

    step(3, "Starting Questbee…")
    run("docker compose up -d")

    print()
    print("─" * 52)
    ok(bold("Questbee is running!"))
    print()
    print("  Open in your browser:")
    print("  " + cyan("http://localhost:3000"))
    if ips:
        for ip in ips:
            print("  " + cyan(f"http://{ip}:3000"))
    print()
    print(f"  Log in with: {bold(admin_email)}")
    print()
    print(f"  {dim('To pair a mobile device, go to Settings → Mobile Pairing.')}")
    print(f"  {dim('Download the Android app: https://github.com/Questbee/app/releases/latest')}")
    print()


def cmd_start():
    _check_installed()
    info("Starting Questbee…")
    run("docker compose up -d")
    ok("Questbee started.")
    _print_urls()


def cmd_stop():
    info("Stopping Questbee…")
    run("docker compose down")
    ok("Questbee stopped.")


def cmd_restart():
    _check_installed()
    info("Restarting Questbee…")
    run("docker compose restart")
    ok("Questbee restarted.")
    _print_urls()


def cmd_logs():
    run("docker compose logs -f", check=False)


def cmd_status():
    run("docker compose ps")


def cmd_update():
    print(f"\n{bold('Questbee — Update')}\n")

    step(1, "Checking Git…")
    ensure_git()

    step(2, "Pulling latest version…")
    run("git pull origin main")

    step(3, "Rebuilding images…")
    run("docker compose build")

    step(4, "Restarting…")
    run("docker compose up -d")

    print()
    ok(bold("Questbee updated and restarted."))
    _print_urls()


def cmd_hostname():
    ips = get_local_ips()
    print()
    if not ips:
        warn("No network addresses detected.")
        return
    print(bold("Questbee is reachable at:"))
    print()
    print("  " + cyan("http://localhost:3000"))
    for ip in ips:
        print("  " + cyan(f"http://{ip}:3000"))
    print()
    print(dim("  Share any of these with users on the same network."))
    print(dim("  Use the LAN IP when pairing the mobile app over Wi-Fi."))
    print()


def cmd_help():
    print(f"""
{bold('Questbee')} — self-hosted field data collection platform

{bold('USAGE')}
  ./questbee <command>        (Mac / Linux)
  questbee <command>          (Windows)

{bold('COMMANDS')}
  {green('install')}    First-time setup: checks Docker, sets passwords, starts the server
  {green('start')}      Start the server
  {green('stop')}       Stop the server
  {green('restart')}    Restart the server
  {green('logs')}       View live logs  (Ctrl+C to exit)
  {green('status')}     Show container status
  {green('update')}     Pull the latest version and restart
  {green('hostname')}   List all URLs where Questbee is reachable on the network
  {green('help')}       Show this message

{bold('MOBILE APP')}
  Download the Android APK from:
  {cyan('https://github.com/Questbee/app/releases/latest')}

  Pair your device via Settings → Mobile Pairing in the web dashboard.
""")

# ── Internal ──────────────────────────────────────────────────────────────────

def _check_installed():
    if not (HERE / ".env").exists():
        err("Questbee is not set up yet.")
        print("  Run " + bold(f"{_cmd()} install") + " first.")
        sys.exit(1)

def _print_urls():
    ips = get_local_ips()
    print("  " + cyan("http://localhost:3000"))
    if ips:
        print("  " + cyan(f"http://{ips[0]}:3000"))

# ── Entry point ───────────────────────────────────────────────────────────────

COMMANDS = {
    "install":  cmd_install,
    "start":    cmd_start,
    "stop":     cmd_stop,
    "restart":  cmd_restart,
    "logs":     cmd_logs,
    "status":   cmd_status,
    "update":   cmd_update,
    "hostname": cmd_hostname,
    "help":     cmd_help,
    "-h":       cmd_help,
    "--help":   cmd_help,
}

def main():
    if len(sys.argv) < 2:
        cmd_help()
        sys.exit(0)
    cmd = sys.argv[1].lower()
    if cmd not in COMMANDS:
        err(f"Unknown command: {cmd}")
        print("  Run " + bold(f"{_cmd()} help") + " for available commands.")
        sys.exit(1)
    COMMANDS[cmd]()

if __name__ == "__main__":
    main()

import argparse
import asyncio
import json
import os
import socket
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


PROVIDER_TEXT_PREFIXES = (
    "i apologize, but i'm unable to generate",
    "i apologize, but i received an unexpected response",
    "i apologize, but i couldn't generate",
    "i'm experiencing issues connecting",
    "the ai service is taking too long",
    "i encountered an unexpected error",
)


def load_env_files() -> None:
    here = Path(__file__).resolve()
    backend_root = here.parents[1]
    repo_root = backend_root.parent
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))
    for env_path in (backend_root / ".env", repo_root / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def scrub_url(value: str) -> str:
    if not value:
        return "(unset)"
    try:
        parts = urlsplit(value)
        if parts.username or parts.password:
            host = parts.hostname or ""
            if parts.port:
                host = f"{host}:{parts.port}"
            return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))
    except Exception:
        pass
    return value


def provider_text_reason(raw: str) -> str:
    lowered = " ".join(str(raw or "").strip().lower().split())
    if not lowered:
        return "empty_response"
    if any(lowered.startswith(prefix) for prefix in PROVIDER_TEXT_PREFIXES):
        return "provider_retry_text"
    return ""


def check_dns(host: str) -> bool:
    try:
        answers = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except Exception as exc:
        print(f"DNS: FAIL - {type(exc).__name__}: {exc}")
        return False
    addresses = sorted({item[4][0] for item in answers})
    print(f"DNS: OK - {host} -> {', '.join(addresses[:4])}")
    return True


def check_tls(host: str, timeout: float = 10.0) -> bool:
    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=host) as tls:
                cert = tls.getpeercert()
                subject = dict(item[0] for item in cert.get("subject", ()))
                print(f"TLS: OK - {tls.version()} cert CN={subject.get('commonName', '(unknown)')}")
                return True
    except Exception as exc:
        print(f"TLS: FAIL - {type(exc).__name__}: {exc}")
        return False


async def check_llm(provider: str | None) -> bool:
    from app.llm.clients.provider_manager import create_llm_client, get_current_provider

    selected_provider = provider or get_current_provider()
    try:
        client = create_llm_client(selected_provider)
    except Exception as exc:
        print(f"LLM client: FAIL - could not create {selected_provider!r}: {type(exc).__name__}: {exc}")
        return False

    model = getattr(client, "model_name", "(unknown)")
    print(f"LLM client: OK - provider={selected_provider}, model={model}")

    started = time.perf_counter()
    try:
        raw = await client.generate(
            system_prompt="Return only valid JSON.",
            context=[{"role": "user", "content": 'Return exactly {"ok": true}.'}],
            temperature=0.0,
            max_tokens=64,
            response_mime_type="application/json",
        )
    except Exception as exc:
        print(f"LLM generate: FAIL - exception {type(exc).__name__}: {exc}")
        return False

    elapsed = time.perf_counter() - started
    reason = provider_text_reason(raw)
    if reason:
        print(f"LLM generate: FAIL - {reason} after {elapsed:.1f}s")
        print(f"Response preview: {str(raw)[:240]}")
        return False

    try:
        parsed = json.loads(str(raw).strip())
    except Exception:
        print(f"LLM generate: WARN - connected, but response was not JSON after {elapsed:.1f}s")
        print(f"Response preview: {str(raw)[:240]}")
        return True

    print(f"LLM generate: OK - {elapsed:.1f}s, response={parsed}")
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description="Test the backend LLM connection without printing secrets.")
    parser.add_argument("--provider", choices=["gemini", "ollama", "vllm"], default=None)
    parser.add_argument("--host", default="generativelanguage.googleapis.com")
    args = parser.parse_args()

    load_env_files()

    print("Proxy environment:")
    for name in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"):
        print(f"  {name}={scrub_url(os.environ.get(name, ''))}")

    dns_ok = check_dns(args.host)
    tls_ok = check_tls(args.host) if dns_ok else False
    llm_ok = await check_llm(args.provider)

    if dns_ok and tls_ok and llm_ok:
        print("RESULT: PASS - backend LLM connectivity looks healthy.")
        return 0

    print("RESULT: FAIL - connection or provider response is not healthy.")
    print("Hint: if TLS or LLM generate fails with ConnectError, check VPN/proxy/firewall settings for Python/httpx.")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

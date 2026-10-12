"""Transcrição local (faster-whisper) no mesmo contrato do servidor da VPS: POST /transcribe com o campo audio_file.

Escuta só em 127.0.0.1: o áudio do dono não sai do computador. Uso:
  python scripts/whisper_local.py            (porta 8000, modelo small; variáveis WHISPER_LOCAL_MODEL e WHISPER_LOCAL_PORT)
"""

import email
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("WHISPER_LOCAL_MODEL", "small")
PORT = int(os.getenv("WHISPER_LOCAL_PORT", "8000"))
MAX_BYTES = 50 * 1024 * 1024
lock = threading.Lock()

print(f"carregando o modelo {MODEL_NAME} (CPU, int8)...", flush=True)
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", local_files_only=True)
print("modelo pronto", flush=True)


def audio_from_multipart(content_type: str, body: bytes) -> bytes | None:
    message = email.message_from_bytes(f"Content-Type: {content_type}\r\n\r\n".encode() + body)
    if not message.is_multipart():
        return None
    for part in message.get_payload():
        if part.get_param("name", header="content-disposition") == "audio_file":
            return part.get_payload(decode=True)
    return None


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/health":
            self._send(200, {"status": "ok", "model_loaded": True, "model": MODEL_NAME})
        else:
            self._send(404, {"detail": "rota inexistente"})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != "/transcribe":
            self._send(404, {"detail": "rota inexistente"})
            return
        query = parse_qs(url.query)
        language = query.get("language", ["pt"])[0]
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BYTES:
            self._send(413 if length > MAX_BYTES else 422, {"detail": "arquivo vazio ou grande demais"})
            return
        audio = audio_from_multipart(self.headers.get("Content-Type", ""), self.rfile.read(length))
        if not audio:
            self._send(422, {"detail": "campo audio_file ausente"})
            return
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as handle:
            handle.write(audio)
            path = handle.name
        try:
            with lock:
                segments, info = model.transcribe(path, language=language, task="transcribe", beam_size=5)
                text = " ".join(segment.text.strip() for segment in segments).strip()
            self._send(200, {"text": text, "language": info.language})
        except Exception as error:
            self._send(422, {"detail": f"não consegui ler o áudio: {str(error)[:160]}"})
        finally:
            os.remove(path)

    def log_message(self, format: str, *args) -> None:
        sys.stdout.write(f"{self.address_string()} {format % args}\n")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"ouvindo em http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()

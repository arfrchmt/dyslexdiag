from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import os


class AppHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        clean_path = path.split("?", 1)[0].split("#", 1)[0]
        if clean_path in ("", "/"):
            clean_path = "/index.html"
        elif clean_path.endswith("/"):
            clean_path = f"{clean_path}index.html"
        elif "." not in Path(clean_path).name:
            clean_path = f"{clean_path}/index.html"
        return super().translate_path(clean_path)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    out_dir = Path(__file__).parent / "out"
    os.chdir(out_dir)
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Serving {out_dir} at http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

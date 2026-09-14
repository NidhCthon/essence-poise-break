"""Serve the repository so tools/preview/ can load the module as ES modules.

    python tools/preview/serve.py        # then open http://127.0.0.1:8791/tools/preview/
    python tools/preview/serve.py 9000   # another port

Python's built-in server does not always know .mjs, and a browser refuses to
run a module served as octet-stream, so this registers the type first.
Bound to 127.0.0.1 only.
"""
import functools
import http.server
import mimetypes
import pathlib
import sys

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
http.server.SimpleHTTPRequestHandler.extensions_map[".mjs"] = "text/javascript"
http.server.SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"

ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
    print("serving {} at http://127.0.0.1:{}/tools/preview/".format(ROOT, PORT), flush=True)
    server.serve_forever()

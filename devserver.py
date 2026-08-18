#!/usr/bin/env python3
"""Dev server that refuses to be cached.

`python3 -m http.server` sends no cache-control headers at all, so Safari -
especially on iOS, where there is no hard-reload gesture - will happily serve
a stale babylon3D.js for as long as it likes. That turns "did my fix work?"
into an unanswerable question: a normal reload gives you the OLD code and the
symptom looks unchanged.

This sends no-store on every response, so an ordinary tap of the reload button
always fetches fresh files from disk. Same document root and port as before.

    python3 devserver.py [port]
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # no-store is the strong one: don't write it to the cache at all.
        # The other two are for older/odd intermediaries that ignore it.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # Strip the conditional headers before the base class sees them.
        # SimpleHTTPRequestHandler answers If-Modified-Since with a 304, which
        # hands the browser its cached copy straight back and defeats the
        # no-store above - so every request has to be forced into a full 200.
        #
        # Overridden HERE rather than in do_GET because do_GET and do_HEAD
        # both funnel through send_head, and a browser's cache revalidation
        # can arrive as either.
        for header in ("If-Modified-Since", "If-None-Match"):
            while header in self.headers:
                del self.headers[header]
        return super().send_head()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    # Threading: a phone holding a connection open shouldn't block the laptop.
    server = ThreadingHTTPServer(("", port), NoCacheHandler)
    print(f"Serving with no-store on http://0.0.0.0:{port} (Ctrl-C to stop)")
    server.serve_forever()

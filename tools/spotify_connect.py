#!/usr/bin/env python3
"""Connect your Spotify account to the site (one time), so the home page can show what you're listening to.

    python3 tools/spotify_connect.py           # the live site (api.nickmade.net)
    python3 tools/spotify_connect.py --local   # the local test Worker (127.0.0.1:8787)

Asks the Worker for a Spotify sign-in link and opens it in your browser; click Agree and you're done.
The live run asks for the admin password (or set NICKMADE_ADMIN_TOKEN). Needs the Spotify app's
Client ID and Secret on the Worker first (see NOTES.md).
"""
import getpass
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

local = "--local" in sys.argv
# Spotify only accepts http:// redirect addresses on 127.0.0.1, not "localhost"
api = "http://127.0.0.1:8787" if local else "https://api.nickmade.net"
token = "local-test-token" if local else (os.environ.get("NICKMADE_ADMIN_TOKEN") or getpass.getpass("Admin password: "))

req = urllib.request.Request(api + "/spotify/auth-url", method="POST", headers={"Authorization": "Bearer " + token})
try:
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.load(res)
except urllib.error.HTTPError as e:
    sys.exit("The Worker said %s: %s" % (e.code, e.read().decode(errors="replace")))

print("Spotify must list this redirect URI in your app's settings:\n  " + data["redirect"])
print("Opening Spotify's sign-in page. Click Agree; the tab will say \"Spotify connected\".")
subprocess.run(["open", data["url"]])

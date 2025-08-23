Deploying assetlinks.json to GitHub Pages

1) Open your Pages repo (likely tayden1990/tayden1990.github.io).
2) Create a folder named `.well-known` at the repo root.
3) Copy the file from this project: `site-assetlinks/.well-known/assetlinks.json` into that `.well-known` folder.
4) Create an empty file named `.nojekyll` in the root of your Pages repo (enables serving dot-directories).
5) Commit and push. Wait ~1–3 minutes.
6) Verify it loads in the browser:
   https://tayden1990.github.io/.well-known/assetlinks.json

Fingerprints used:
- Release: 25:9C:DE:BC:9E:61:90:CD:A3:F4:6F:8A:E5:BE:A5:88:0C:6F:AB:03:DC:34:00:87:36:63:A6:C7:46:22:35:8C
- Debug:   75:1B:15:22:94:E5:22:EE:8D:52:28:36:29:78:2A:30:8F:F9:B8:92:39:C6:1A:B9:1E:6F:F0:A7:1E:99:70:37

If you change signing keys, update the SHA-256 fingerprints in assetlinks.json.

Optional: You can include only the release fingerprint for production. The debug fingerprint is present to ease local testing.

Device verification tips:
- In Chrome on the device, visit: chrome://digital-asset-links
- Use the menu to check statements for your domain and app package.

import os
import certifi

# uv's standalone Python on macOS has no CA bundle, which breaks model and NLTK downloads.
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
